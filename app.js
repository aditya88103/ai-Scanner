(function initMintScan() {
        const $ = (sel) => document.querySelector(sel);
        const VERSION = "20260403-03";

        window.NutriScan = {
          VERSION,
          $,
          screens: {
            scan: $("#screen-scan"),
            loading: $("#screen-loading"),
            result: $("#screen-result"),
            error: $("#screen-error"),
            history: $("#screen-history"),
            about: $("#screen-about"),
          },
          els: {
            phone: $("#phone"),
            scanner: $("#scanner"),
            fab: $("#fab-scan"),
            fabIcon: $("#fab-icon"),
            toast: $("#toast"),
            flash: $("#success-flash"),
            pillStatus: $("#pill-status"),
            pillSecure: $("#pill-secure"),

            modal: $("#modal-manual"),
            modalBackdrop: $("#modal-backdrop"),
            btnManualOpen: $("#btn-manual-open"),
            btnManualClose: $("#btn-manual-close"),
            manualInput: $("#manual-input"),
            manualLookup: $("#manual-lookup"),
            manualPaste: $("#manual-paste"),
            btnTorch: $("#btn-torch"),

            btnBackToScan: $("#btn-back-to-scan"),

            errInput: $("#err-input"),
            errLookup: $("#err-lookup"),
            errScanAgain: $("#err-scan-again"),
            btnErrorBack: $("#btn-error-back"),
            errTitle: $("#err-title"),
            errMsg: $("#err-msg"),

            // Product
            pImage: $("#p-image"),
            pName: $("#p-name"),
            pBrand: $("#p-brand"),
            pMeta: $("#p-meta"),
            scoreNum: $("#score-num"),
            scoreLab: $("#score-lab"),
            scoreExplain: $("#score-explain"),
            detailsBadges: $("#p-details-badges"),
            detailsGrid: $("#p-details-grid"),
            nutriTable: $("#nutri-table"),
            ingSub: $("#ing-sub"),
            ingList: $("#ing-list"),
            allergenBadges: $("#allergen-badges"),

            historyStrip: $("#history-strip"),
            btnClearHistory: $("#btn-clear-history"),
          },
           STORAGE_KEY: "nutriscan_history_v1",
           LEGACY_STORAGE_KEYS: ["mintscan_history_v1"],
           state: {
             scanning: false,
             lastCode: null,
             lastDetectedAt: 0,
             history: [],
             currentBarcode: null,
            currentProduct: null,
            quaggaReady: false,
            scanToken: 0,
            scannerEngine: null, // "barcode-detector" | "quagga"
            cameraStream: null,
            cameraVideo: null,
            barcodeDetector: null,
            detectorToken: 0,
            detectorLastAt: 0,
            cameraReleaseTimer: null,
            torchOn: false,
            candidateCode: null,
            candidateCount: 0,
            candidateAt: 0,
          },
          util: {},
          health: {},
          render: {},
          history: {},
          api: {},
          scanner: {},
        };
      })();

(function utilModule(M) {
        const { els, screens, state } = M;

        const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        const escapeHtml = (str) =>
          String(str ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

        const num = (v) => {
          if (v === null || v === undefined) return null;
          const n = Number(String(v).replace(",", "."));
          return Number.isFinite(n) ? n : null;
        };

        const fmt = (value, unit = "") => {
          if (value === null || value === undefined) return "â€”";
          const v = Number(value);
          if (!Number.isFinite(v)) return "â€”";
          const s = v % 1 === 0 ? String(v) : v.toFixed(1);
          return unit ? `${s}${unit}` : s;
        };

        function toast(msg) {
          els.toast.textContent = msg;
          els.toast.classList.remove("is-on");
          // Restart animation
          void els.toast.offsetWidth;
          els.toast.classList.add("is-on");
          clearTimeout(toast._t);
          toast._t = setTimeout(() => els.toast.classList.remove("is-on"), 2400);
        }

        function setActiveNav(screenName) {
          document.querySelectorAll(".nav-btn").forEach((b) => {
            b.classList.toggle("is-active", b.dataset.screen === screenName);
          });
        }

        function showScreen(screenName) {
          Object.entries(screens).forEach(([k, el]) => {
            el.classList.toggle("is-active", k === screenName);
          });

          const navTarget = ["loading", "result", "error"].includes(screenName) ? "scan" : screenName;
          setActiveNav(navTarget);

          // Camera should only run while on scan screen.
          if (screenName !== "scan" && typeof M.scanner.stopScanner === "function") {
            M.scanner.stopScanner({ releaseCamera: true });
          }
        }

        function openModal() {
          els.modal.classList.add("is-open");
          els.modal.setAttribute("aria-hidden", "false");
          setTimeout(() => els.manualInput.focus(), 40);
        }

        function closeModal() {
          els.modal.classList.remove("is-open");
          els.modal.setAttribute("aria-hidden", "true");
        }

        function normalizeBarcode(raw) {
          const code = String(raw ?? "").trim().replace(/\s+/g, "");
          const digits = code.replace(/[^\d]/g, "");
          return digits || null;
        }

        M.util = { clamp, sleep, escapeHtml, num, fmt, toast, showScreen, setActiveNav, openModal, closeModal, normalizeBarcode };
      })(window.NutriScan);

(function healthModule(M) {
        const { clamp, num } = M.util;

        const nutriBase = { a: 90, b: 75, c: 55, d: 35, e: 15 };

        function classifyScore(score) {
          if (score >= 80) return { label: "Excellent", color: "var(--good)" };
          if (score >= 60) return { label: "Good", color: "var(--okay)" };
          if (score >= 40) return { label: "Moderate", color: "var(--warn)" };
          if (score >= 20) return { label: "Poor", color: "var(--bad)" };
          return { label: "Avoid", color: "var(--danger)" };
        }

        function scoreTo10(score) {
          const s = Number(score);
          if (!Number.isFinite(s)) return 0;
          return Math.round(s) / 10;
        }

        function formatScore10(score) {
          const v = scoreTo10(score);
          return Number.isInteger(v) ? String(v) : v.toFixed(1);
        }

        function computeHealthScore(product) {
          const nutriments = product?.nutriments ?? {};

          const nutri = String(product?.nutriscore_grade ?? "").toLowerCase();
          const base = nutriBase[nutri] ?? 52;

          const sugar = num(nutriments.sugars_100g);
          const satFat = num(nutriments["saturated-fat_100g"]);
          const fiber = num(nutriments.fiber_100g);
          const protein = num(nutriments.proteins_100g);
          const salt = num(nutriments.salt_100g);
          const sodium = num(nutriments.sodium_100g);
          const saltFromSodium = sodium === null ? null : sodium * 2.5;
          const saltVal = salt ?? saltFromSodium;

          const additivesCount =
            num(product?.additives_n) ??
            (Array.isArray(product?.additives_tags) ? product.additives_tags.length : 0);

          const allergensCount = Array.isArray(product?.allergens_tags) ? product.allergens_tags.length : 0;

          const penalties = [];
          const bonuses = [];

          let score = base;

          // Penalties / bonuses (per 100g)
          if (sugar !== null && sugar > 10) {
            const p = clamp((sugar - 10) * 2.0, 0, 26);
            score -= p;
            penalties.push({ label: "High sugar", value: -p });
          }

          if (satFat !== null && satFat > 5) {
            const p = clamp((satFat - 5) * 3.0, 0, 22);
            score -= p;
            penalties.push({ label: "High saturated fat", value: -p });
          }

          if (saltVal !== null && saltVal > 0.5) {
            const p = clamp((saltVal - 0.5) * 18, 0, 22);
            score -= p;
            penalties.push({ label: "High salt/sodium", value: -p });
          }

          if (fiber !== null && fiber > 3) {
            const b = clamp((fiber - 3) * 2.0, 0, 12);
            score += b;
            bonuses.push({ label: "Fiber bonus", value: b });
          }

          if (protein !== null && protein > 5) {
            const b = clamp((protein - 5) * 1.4, 0, 10);
            score += b;
            bonuses.push({ label: "Protein bonus", value: b });
          }

          if (additivesCount > 0) {
            const p = clamp(additivesCount * 2.2, 0, 18);
            score -= p;
            penalties.push({ label: "Additives", value: -p });
          }

          if (allergensCount > 0) {
            const p = clamp(allergensCount * 1.2, 0, 10);
            score -= p;
            penalties.push({ label: "Allergens", value: -p });
          }

          const finalScore = clamp(Math.round(score), 0, 100);
          const grade = classifyScore(finalScore);

          return {
            score: finalScore,
            grade,
            base,
            penalties,
            bonuses,
            metrics: { sugar, satFat, fiber, protein, salt: saltVal, additivesCount, allergensCount },
          };
        }

        M.health = { classifyScore, computeHealthScore, scoreTo10, formatScore10 };
      })(window.NutriScan);

(function renderHelpers(M) {
        const { escapeHtml, num, fmt } = M.util;

        const HARMFUL_KEYS = [
          "palm oil",
          "high fructose corn syrup",
          "hfcs",
          "aspartame",
          "acesulfame",
          "sucralose",
          "sodium nitrite",
          "bha",
          "bht",
          "artificial color",
          "artificial colours",
          "artificial colors",
          "caramel color",
          "red 40",
          "yellow 5",
          "yellow 6",
          "blue 1",
        ];

        function ingredientIsHarmful(text) {
          const t = String(text ?? "").toLowerCase();
          return HARMFUL_KEYS.some((k) => t.includes(k));
        }

        function nutriBadge(grade) {
          const g = String(grade ?? "").toUpperCase();
          const map = {
            A: "rgba(46,229,157,0.22)",
            B: "rgba(156,229,108,0.18)",
            C: "rgba(255,183,3,0.16)",
            D: "rgba(255,107,53,0.16)",
            E: "rgba(255,59,107,0.18)",
          };
          const border = {
            A: "rgba(46,229,157,0.38)",
            B: "rgba(156,229,108,0.35)",
            C: "rgba(255,183,3,0.35)",
            D: "rgba(255,107,53,0.35)",
            E: "rgba(255,59,107,0.38)",
          };
          if (!map[g]) return "";
          return `<span class="badge" style="background:${map[g]};border-color:${border[g]};color:rgba(255,255,255,0.92)"><b>Nutri-Score</b> ${escapeHtml(
            g
          )}</span>`;
        }

        function ecoBadge(grade) {
          const g = String(grade ?? "").toUpperCase();
          if (!g) return "";
          const map = {
            A: "rgba(46,229,157,0.18)",
            B: "rgba(156,229,108,0.14)",
            C: "rgba(255,183,3,0.14)",
            D: "rgba(255,107,53,0.14)",
            E: "rgba(255,59,107,0.14)",
          };
          return `<span class="badge" style="background:${map[g] ?? "rgba(255,255,255,0.04)"};border-color: rgba(255,255,255,0.08)"><b>Eco-Score</b> ${escapeHtml(
            g
          )}</span>`;
        }

        function novaBadge(n) {
          const v = Number(n);
          if (!Number.isFinite(v)) return "";
          const text = {
            1: "Minimally processed",
            2: "Culinary ingredients",
            3: "Processed foods",
            4: "Ultra-processed",
          }[v];
          const style = v === 4 ? "badge--warn" : v === 1 ? "badge--mint" : "";
          return `<span class="badge ${style}"><b>NOVA ${escapeHtml(v)}</b> ${escapeHtml(text ?? "")}</span>`;
        }

        function labelBadges(product) {
          const labelsStr = product?.labels ?? "";
          const labels = String(labelsStr)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 10);

          if (!labels.length) return "";
          return labels
            .map((l) => `<span class="badge badge--mint"><b>Label</b> ${escapeHtml(l)}</span>`)
            .join("");
        }

        function kvCard(label, value) {
          return `
            <div class="card pad" style="background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06); box-shadow:none">
              <div class="sub">${escapeHtml(label)}</div>
              <div style="height:6px"></div>
              <div style="font-weight:800; letter-spacing:-0.02em; line-height:1.15">${escapeHtml(value || "")}</div>
            </div>
          `;
        }

        function nutriDot(key, value) {
          // Simple per-100g thresholds
          const v = value === null ? null : Number(value);
          const k = String(key);
          if (!Number.isFinite(v)) return { cls: "", note: "" };

          if (k === "sugars") {
            if (v <= 5) return { cls: "good", note: "Low sugar" };
            if (v <= 10) return { cls: "warn", note: "Moderate sugar" };
            return { cls: "danger", note: "High sugar" };
          }

          if (k === "satfat") {
            if (v <= 1.5) return { cls: "good", note: "Low sat. fat" };
            if (v <= 5) return { cls: "warn", note: "Moderate sat. fat" };
            return { cls: "danger", note: "High sat. fat" };
          }

          if (k === "sodium") {
            if (v <= 0.12) return { cls: "good", note: "Low sodium" };
            if (v <= 0.24) return { cls: "warn", note: "Moderate sodium" };
            return { cls: "danger", note: "High sodium" };
          }

          if (k === "fiber") {
            if (v >= 6) return { cls: "good", note: "High fiber" };
            if (v >= 3) return { cls: "okay", note: "Good fiber" };
            return { cls: "warn", note: "Low fiber" };
          }

          if (k === "protein") {
            if (v >= 10) return { cls: "good", note: "High protein" };
            if (v >= 5) return { cls: "okay", note: "Good protein" };
            return { cls: "warn", note: "Low protein" };
          }

          return { cls: "", note: "" };
        }

        function extractIngredients(product) {
          const arr = Array.isArray(product?.ingredients) ? product.ingredients : null;
          if (arr && arr.length) {
            const items = arr
              .map((i) => i?.text ?? i?.id ?? "")
              .map((s) => String(s).trim())
              .filter(Boolean);
            if (items.length) return items;
          }

          const text =
            product?.ingredients_text_en ??
            product?.ingredients_text ??
            product?.ingredients_text_with_allergens_en ??
            product?.ingredients_text_with_allergens ??
            "";
          const s = String(text).trim();
          if (!s) return [];
          return s
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean)
            .slice(0, 70);
        }

        function extractAllergens(product) {
          const tags = Array.isArray(product?.allergens_tags) ? product.allergens_tags : [];
          const cleaned = tags
            .map((t) => String(t).split(":").pop())
            .map((t) => t.replaceAll("-", " "))
            .map((t) => t.trim())
            .filter(Boolean);
          return Array.from(new Set(cleaned)).slice(0, 12);
        }

        M.render.helpers = { HARMFUL_KEYS, ingredientIsHarmful, nutriBadge, ecoBadge, novaBadge, labelBadges, kvCard, nutriDot, extractIngredients, extractAllergens, num, fmt };
      })(window.NutriScan);

(function renderModule(M) {
        const { els, state } = M;
        const { escapeHtml, fmt, num, clamp } = M.util;
        const { classifyScore } = M.health;
        const H = M.render.helpers;

        function renderNutritionTable(product) {
          const n = product?.nutriments ?? {};

          const kcal = (() => {
            const v = num(n["energy-kcal_100g"]);
            if (v !== null) return v;
            const kj = num(n.energy_100g);
            if (kj === null) return null;
            return kj / 4.184;
          })();

          const protein = num(n.proteins_100g);
          const carbs = num(n.carbohydrates_100g);
          const sugar = num(n.sugars_100g);
          const fat = num(n.fat_100g);
          const satFat = num(n["saturated-fat_100g"]);
          const fiber = num(n.fiber_100g);
          const sodium = (() => {
            const s = num(n.sodium_100g);
            if (s !== null) return s;
            const salt = num(n.salt_100g);
            if (salt === null) return null;
            return salt / 2.5;
          })();

          const rows = [
            { label: "Calories", value: kcal, unit: " kcal" },
            { label: "Protein", value: protein, unit: " g", dotKey: "protein" },
            { label: "Carbs", value: carbs, unit: " g" },
            { label: "Sugar", value: sugar, unit: " g", dotKey: "sugars" },
            { label: "Fat", value: fat, unit: " g" },
            { label: "Saturated fat", value: satFat, unit: " g", dotKey: "satfat" },
            { label: "Fiber", value: fiber, unit: " g", dotKey: "fiber" },
            { label: "Sodium", value: sodium, unit: " g", dotKey: "sodium" },
          ].filter((r) => r.value !== null && r.value !== undefined);

          if (!rows.length) {
            els.nutriTable.innerHTML = `<div class="sub">Nutrition details not available for this product.</div>`;
            return;
          }

          els.nutriTable.innerHTML = rows
            .map((r) => {
              const { cls, note } = r.dotKey ? H.nutriDot(r.dotKey, r.value) : { cls: "", note: "" };
              const dot = r.dotKey
                ? `<span class="dot ${escapeHtml(cls)}" title="${escapeHtml(note)}"></span>`
                : `<span class="dot"></span>`;
              return `
                <div class="row2">
                  <div class="k">${dot}${escapeHtml(r.label)}</div>
                  <div class="v">${escapeHtml(fmt(r.value, r.unit))}</div>
                </div>
              `;
            })
            .join("");
        }

        function renderIngredients(product) {
          const ingredients = H.extractIngredients(product);
          const allergens = H.extractAllergens(product);

          els.allergenBadges.innerHTML = allergens.length
            ? allergens.map((a) => `<span class="badge badge--warn"><b>Allergen</b> ${escapeHtml(a)}</span>`).join("")
            : `<span class="badge"><b>Allergens</b> None listed</span>`;

          if (!ingredients.length) {
            els.ingSub.textContent = "No ingredient list available for this product.";
            els.ingList.innerHTML = `<div class="ing">Ingredients not provided.</div>`;
            return;
          }

          const harmfulCount = ingredients.filter(H.ingredientIsHarmful).length;
          els.ingSub.textContent = harmfulCount
            ? `We flagged ${harmfulCount} ingredient${harmfulCount === 1 ? "" : "s"} using a simple keyword check.`
            : "No obvious red-flag keywords found (based on a simple list).";

          els.ingList.innerHTML = ingredients
            .map((t) => {
              const harmful = H.ingredientIsHarmful(t);
              return `<div class="ing ${harmful ? "is-harmful" : ""}">${escapeHtml(t)}</div>`;
            })
            .join("");
        }

        function renderDetails(product) {
          const nutri = product?.nutriscore_grade ? String(product.nutriscore_grade).toUpperCase() : "";
          const eco = product?.ecoscore_grade ? String(product.ecoscore_grade).toUpperCase() : "";
          const nova = product?.nova_group;
          const pkg = product?.packaging_text ?? product?.packaging ?? "";
          const cats = product?.categories ?? "";
          const countries = product?.countries ?? "";

          const badgeParts = [H.nutriBadge(nutri), H.novaBadge(nova), eco ? H.ecoBadge(eco) : "", H.labelBadges(product)].filter(
            Boolean
          );
          const badges = badgeParts.join("");
          els.detailsBadges.innerHTML = badges;
          els.detailsBadges.style.display = badges ? "flex" : "none";

          const details = [];
          const catText = cats ? cats.split(",").slice(0, 2).join(", ").trim() : "";
          const countryText = countries ? countries.split(",").slice(0, 2).join(", ").trim() : "";
          const pkgText = pkg ? String(pkg).split(",").slice(0, 2).join(", ").trim() : "";
          const barcodeText = state.currentBarcode ? String(state.currentBarcode) : "";

          if (catText) details.push(H.kvCard("Category", catText));
          if (countryText) details.push(H.kvCard("Country of origin", countryText));
          if (pkgText) details.push(H.kvCard("Packaging", pkgText));
          if (barcodeText) details.push(H.kvCard("Barcode", barcodeText));

          els.detailsGrid.innerHTML = details.join("");
          els.detailsGrid.style.display = details.length ? "grid" : "none";

          const detailsCard = M.$("#details-card");
          if (detailsCard) detailsCard.style.display = badges || details.length ? "block" : "none";
        }

        function renderProductHeader(product, health) {
          const name = product?.product_name_en ?? product?.product_name ?? "Unknown product";
          const brand = product?.brands ?? "Brand not listed";
          const img = product?.image_front_url ?? product?.image_url ?? "";

          els.pName.textContent = name;
          els.pBrand.textContent = brand;

          if (img) {
            els.pImage.src = img;
            els.pImage.alt = name;
            els.pImage.style.display = "block";
          } else {
            els.pImage.removeAttribute("src");
            els.pImage.alt = "";
            els.pImage.style.display = "none";
          }

          const metaParts = [];
          metaParts.push(`<span class="badge badge--mint"><b>Nutri</b> ${escapeHtml(health.grade.label)}</span>`);
          metaParts.push(H.nutriBadge(product?.nutriscore_grade));

          const addN = health.metrics.additivesCount ?? 0;
          metaParts.push(
            `<span class="badge ${addN ? "badge--warn" : ""}"><b>Additives</b> ${escapeHtml(String(addN))}</span>`
          );

          els.pMeta.innerHTML = metaParts.filter(Boolean).join("");
        }

        function renderScore(health) {
          const circle = M.$("#screen-result .ring .prog");
          const r = 50;
          const c = 2 * Math.PI * r;
          circle.style.strokeDasharray = `${c}`;
          circle.style.stroke = health.grade.color;

          const target = clamp(health.score, 0, 100);
          const dash = c * (1 - target / 100);
          circle.style.strokeDashoffset = `${dash}`;

          // Count-up animation
          const duration = 750;
          const t0 = performance.now();
          const { scoreTo10, formatScore10 } = M.health;
          const from = Number(els.scoreNum.textContent) || 0;
          const to = scoreTo10(target);

          function tick(now) {
            const p = clamp((now - t0) / duration, 0, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            const v = from + (to - from) * eased;
            const rounded = Math.round(v * 10) / 10;
            els.scoreNum.textContent = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
            if (p < 1) requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);

          els.scoreLab.textContent = "out of 10";

          const lines = [];
          lines.push(
            `<div class="line"><span>Nutri-Score base (out of 10)</span><b>${escapeHtml(formatScore10(health.base))}</b></div>`
          );

          if (health.metrics.sugar !== null) {
            lines.push(
              `<div class="line"><span>Sugar (per 100g)</span><b>${escapeHtml(fmt(health.metrics.sugar, " g"))}</b></div>`
            );
          }
          if (health.metrics.satFat !== null) {
            lines.push(
              `<div class="line"><span>Sat. fat (per 100g)</span><b>${escapeHtml(fmt(health.metrics.satFat, " g"))}</b></div>`
            );
          }
          if (health.metrics.salt !== null) {
            lines.push(
              `<div class="line"><span>Salt equiv. (per 100g)</span><b>${escapeHtml(fmt(health.metrics.salt, " g"))}</b></div>`
            );
          }

          const adj = [...health.penalties, ...health.bonuses]
            .filter((x) => Math.round(x.value) !== 0)
            .slice(0, 4)
            .map((x) => {
              const v10 = scoreTo10(x.value);
              const sign = v10 > 0 ? "+" : "";
              const shown = Number.isInteger(v10) ? String(v10) : v10.toFixed(1);
              return `<div class="line"><span>${escapeHtml(x.label)} (out of 10)</span><b>${escapeHtml(sign + shown)}</b></div>`;
            });

          if (adj.length) lines.push(`<div style="height:6px"></div>`, ...adj);

          els.scoreExplain.innerHTML = lines.join("");
        }

        M.render = { ...M.render, renderNutritionTable, renderIngredients, renderDetails, renderProductHeader, renderScore };
      })(window.NutriScan);

(function historyModule(M) {
        const { els, state, STORAGE_KEY, LEGACY_STORAGE_KEYS } = M;
          const { escapeHtml, toast } = M.util;
          const { classifyScore, formatScore10 } = M.health;

        function loadHistory() {
          try {
            const fromKey = (key) => {
              const raw = localStorage.getItem(key);
              if (!raw) return [];
              const parsed = JSON.parse(raw);
              return Array.isArray(parsed) ? parsed : [];
            };

            const current = fromKey(STORAGE_KEY);
            if (current.length) return current;

            const legacyKeys = Array.isArray(LEGACY_STORAGE_KEYS) ? LEGACY_STORAGE_KEYS : [];
            for (const key of legacyKeys) {
              const legacy = fromKey(key);
              if (!legacy.length) continue;
              saveHistory(legacy);
              try {
                localStorage.removeItem(key);
              } catch {
                // ignore
              }
              return legacy;
            }

            return [];
          } catch {
            return [];
          }
        }

        function saveHistory(history) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 10)));
          } catch {
            // ignore (private browsing, etc.)
          }
        }

        function addToHistory(item) {
          const barcode = String(item?.barcode ?? "");
          const rest = state.history.filter((h) => String(h?.barcode ?? "") !== barcode);
          state.history = [item, ...rest].slice(0, 10);
          saveHistory(state.history);
          renderHistory();
        }

        function scoreColor(score) {
          return classifyScore(score).color;
        }

        function renderHistory() {
          if (!els.historyStrip) return;

          if (!state.history.length) {
            els.historyStrip.innerHTML = `<div class="hcard" style="width: 100%; cursor: default"><div class="t1">No scans yet</div><div class="t2">Scan a product to build your history.</div></div>`;
            return;
          }

          els.historyStrip.innerHTML = state.history
            .map((h) => {
              const name = h.name || "Unknown product";
              const brand = h.brand || "Brand not listed";
              const score = Number(h.score);
              const score10 = formatScore10(score);
              const label = classifyScore(score).label;
              const img = h.image || "";
              const color = scoreColor(score);
              return `
                <div class="hcard" data-barcode="${escapeHtml(h.barcode)}" role="button" aria-label="View ${escapeHtml(
                  name
                )}">
                  <div class="top">
                    <div class="thumb">${img ? `<img alt="" src="${escapeHtml(img)}" />` : ""}</div>
                    <div>
                      <div class="t1">${escapeHtml(name)}</div>
                      <div class="t2">${escapeHtml(brand)}</div>
                    </div>
                  </div>
                  <div class="score">
                    <div class="n" style="color:${escapeHtml(color)}">${escapeHtml(score10)}</div>
                    <div class="l">${escapeHtml(label)} /10</div>
                  </div>
                </div>
              `;
            })
            .join("");
        }

        function clearHistory() {
          state.history = [];
          saveHistory(state.history);
          renderHistory();
          toast("History cleared.");
        }

        M.history = { loadHistory, saveHistory, addToHistory, renderHistory, clearHistory };
      })(window.NutriScan);

(function apiModule(M) {
        const { els, state } = M;
        const { normalizeBarcode, toast, showScreen, sleep } = M.util;
        const { computeHealthScore } = M.health;
        const { renderProductHeader, renderScore, renderDetails, renderNutritionTable, renderIngredients } = M.render;
        const { addToHistory } = M.history;

        function fetchWithTimeout(url, { timeoutMs = 5500, cache } = {}) {
          if (typeof AbortController === "undefined") {
            return fetch(url, cache ? { cache } : undefined);
          }
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), timeoutMs);
          const opts = { signal: controller.signal };
          if (cache) opts.cache = cache;
          return fetch(url, opts).finally(() => clearTimeout(t));
        }

        async function safeFetch(url, opts = {}) {
          try {
            return await fetchWithTimeout(url, opts);
          } catch (err) {
            // Fallback for browsers that choke on fetch options
            return fetch(url);
          }
        }

        function parseProduct(data) {
          if (!data) return null;
          if (data.status === 1 && data.product) return data.product;
          if (data.product) return data.product;
          return null;
        }

        function buildFieldsParam() {
          const fields = [
            "product_name",
            "product_name_en",
            "brands",
            "image_front_url",
            "image_url",
            "nutriscore_grade",
            "ecoscore_grade",
            "nova_group",
            "packaging_text",
            "packaging",
            "categories",
            "countries",
            "nutriments",
            "ingredients",
            "ingredients_text",
            "ingredients_text_en",
            "ingredients_text_with_allergens",
            "ingredients_text_with_allergens_en",
            "allergens_tags",
            "labels",
          ];
          return `fields=${encodeURIComponent(fields.join(","))}`;
        }

        async function fetchProductFrom(url, opts = {}) {
          const res = await safeFetch(url, opts);

          if (res.status === 404) {
            const err = new Error("NOT_FOUND");
            err.code = "NOT_FOUND";
            throw err;
          }

          if (!res.ok) {
            const err = new Error(`HTTP ${res.status}`);
            err.code = res.status === 429 ? "RATE_LIMIT" : "HTTP_ERROR";
            err.status = res.status;
            throw err;
          }

          let data;
          try {
            data = await res.json();
          } catch (e) {
            const err = new Error("BAD_JSON");
            err.code = "BAD_JSON";
            err.cause = e;
            throw err;
          }

          const product = parseProduct(data);
          if (!product) {
            const err = new Error("NOT_FOUND");
            err.code = "NOT_FOUND";
            throw err;
          }
          return product;
        }

        async function fetchProduct(barcode) {
          const code = normalizeBarcode(barcode);
          if (!code) throw new Error("INVALID");

          const candidates = [];
          const pushCandidate = (value) => {
            const normalized = normalizeBarcode(value);
            if (!normalized) return;
            if (!candidates.includes(normalized)) candidates.push(normalized);
          };

          // Common barcode variants:
          // - UPC-A (12) is often stored as EAN-13 with leading 0
          pushCandidate(code);
          if (code.length === 12) pushCandidate(`0${code}`);
          if (code.length === 13 && code.startsWith("0")) pushCandidate(code.slice(1));

          const IN_BASE = "https://in.openfoodfacts.org";
          const WORLD_BASE = "https://world.openfoodfacts.org";

          const fields = buildFieldsParam();
          const urls = [];

          for (const c of candidates) {
            urls.push({
              kind: "product",
              url: `${IN_BASE}/api/v2/product/${encodeURIComponent(c)}.json?${fields}`,
              timeoutMs: 5500,
            });
            urls.push({
              kind: "product",
              url: `${WORLD_BASE}/api/v2/product/${encodeURIComponent(c)}.json?${fields}`,
              timeoutMs: 6500,
            });
          }

          for (const c of candidates) {
            urls.push({
              kind: "product",
              url: `${WORLD_BASE}/api/v0/product/${encodeURIComponent(c)}.json`,
              timeoutMs: 7500,
            });
          }

          for (const c of candidates) {
            urls.push({
              kind: "search",
              url: `${WORLD_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(
                c
              )}&search_simple=1&action=process&json=1&page_size=1`,
              timeoutMs: 8000,
            });
          }

          let sawNotFound = false;
          let lastError = null;

          for (const item of urls) {
            try {
              if (item.kind === "search") {
                const res = await safeFetch(item.url, { timeoutMs: item.timeoutMs, cache: "no-store" });

                if (res.status === 404) {
                  sawNotFound = true;
                  continue;
                }

                if (!res.ok) {
                  const err = new Error(`HTTP ${res.status}`);
                  err.code = res.status === 429 ? "RATE_LIMIT" : "HTTP_ERROR";
                  err.status = res.status;
                  throw err;
                }

                let data;
                try {
                  data = await res.json();
                } catch (e) {
                  const err = new Error("BAD_JSON");
                  err.code = "BAD_JSON";
                  err.cause = e;
                  throw err;
                }

                const product = data?.products?.[0] ?? null;
                if (!product) {
                  sawNotFound = true;
                  continue;
                }
                return product;
              }

              return await fetchProductFrom(item.url, { timeoutMs: item.timeoutMs, cache: "no-store" });
            } catch (e) {
              if (e?.code === "NOT_FOUND") {
                sawNotFound = true;
                continue;
              }
              if (e?.code === "RATE_LIMIT") throw e;
              lastError = e;
            }
          }

          if (sawNotFound) {
            const err = new Error("NOT_FOUND");
            err.code = "NOT_FOUND";
            throw err;
          }
          if (lastError) throw lastError;

          const err = new Error("NOT_FOUND");
          err.code = "NOT_FOUND";
          throw err;
        }

        async function analyzeBarcode(barcode, { source = "scan" } = {}) {
          const code = normalizeBarcode(barcode);
          if (!code || code.length < 8) {
            toast("Enter a valid EAN/UPC code.");
            return;
          }

          state.currentBarcode = code;
          if (typeof M.scanner?.stopScanner === "function") {
            M.scanner.stopScanner({ releaseCamera: true });
          }

          showScreen("loading");
          await sleep(140); // lets the loading animation breathe

          try {
            const product = await fetchProduct(code);
            state.currentProduct = product;

            const health = computeHealthScore(product);

            renderProductHeader(product, health);
            renderScore(health);
            renderDetails(product);
            renderNutritionTable(product);
            renderIngredients(product);

            showScreen("result");

            addToHistory({
              barcode: code,
              name: product?.product_name_en ?? product?.product_name ?? "Unknown product",
              brand: product?.brands ?? "Brand not listed",
              image: product?.image_front_url ?? product?.image_url ?? "",
              score: health.score,
              nutriscore: product?.nutriscore_grade ?? "",
              at: new Date().toISOString(),
            });

            if (source === "scan") {
              // Micro-interaction: flash + optional vibration
              els.flash.classList.remove("is-on");
              void els.flash.offsetWidth;
              els.flash.classList.add("is-on");
              els.phone.classList.remove("is-bump");
              void els.phone.offsetWidth;
              els.phone.classList.add("is-bump");
              setTimeout(() => els.phone.classList.remove("is-bump"), 260);
              if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
            }
          } catch (e) {
            let msg = "Network error while fetching product.";
            let title = "We couldn't find that product";

            if (e?.code === "NOT_FOUND") {
              msg = "Not found in Open Food Facts. Try scanning again or enter the code manually.";
            } else if (e?.code === "RATE_LIMIT") {
              title = "Too many requests";
              msg = "Open Food Facts is rate-limiting. Please wait 20 seconds and try again.";
            } else if (e?.name === "AbortError") {
              title = "Request timed out";
              msg = "Your internet seems slow. Please try again.";
            } else if (e?.code === "BAD_JSON") {
              title = "Unexpected response";
              msg = "Open Food Facts returned an unexpected response. Please try again.";
            } else if (typeof e?.status === "number") {
              title = "Server error";
              msg = `Open Food Facts error (HTTP ${e.status}). Please try again.`;
            }

            els.errTitle.textContent = title;
            els.errMsg.textContent = msg;
            els.errInput.value = code;
            showScreen("error");
          }
        }

        M.api = { fetchProduct, analyzeBarcode };
      })(window.NutriScan);

(function scannerModule(M) {
        const { els, state } = M;
        const { escapeHtml, normalizeBarcode, toast, sleep } = M.util;

        const CAMERA_WARM_MS = 120000;
        const DETECT_THROTTLE_MS = 80;

        function ensureSecureHint() {
          const ok =
            window.isSecureContext ||
            location.hostname === "localhost" ||
            location.hostname === "127.0.0.1" ||
            location.protocol === "https:";
          els.pillSecure.style.display = ok ? "none" : "inline-flex";
          return ok;
        }

        function setScanPill(textStrong, textRest = "") {
          const strong = `<strong>${escapeHtml(textStrong)}</strong>`;
          const rest = textRest ? ` ${escapeHtml(textRest)}` : "";
          els.pillStatus.innerHTML = strong + rest;
        }

        function isValidGtin(code) {
          const digits = String(code ?? "").replace(/[^\d]/g, "");
          const len = digits.length;
          if (![8, 12, 13, 14].includes(len)) return false;

          let sum = 0;
          let pos = 0;
          for (let i = len - 2; i >= 0; i -= 1) {
            const n = Number(digits[i]);
            if (!Number.isFinite(n)) return false;
            const weight = pos % 2 === 0 ? 3 : 1;
            sum += n * weight;
            pos += 1;
          }
          const check = (10 - (sum % 10)) % 10;
          return check === Number(digits[len - 1]);
        }

        function acceptBarcode(code) {
          state.candidateCode = null;
          state.candidateCount = 0;
          state.candidateAt = 0;
          stopScanner();
          M.api.analyzeBarcode(code, { source: "scan" });
        }

        function setFabScanning(isScanning) {
          els.fab.classList.toggle("is-scanning", Boolean(isScanning));
          els.fab.setAttribute("aria-label", isScanning ? "Stop scan" : "Start scan");
          els.fabIcon.innerHTML = isScanning
            ? `<path d="M7 7h10v10H7z" />`
            : `
              <path d="M7 4H5a2 2 0 0 0-2 2v2" />
              <path d="M17 4h2a2 2 0 0 1 2 2v2" />
              <path d="M7 20H5a2 2 0 0 1-2-2v-2" />
              <path d="M17 20h2a2 2 0 0 0 2-2v-2" />
              <path d="M7 12h10" />
            `;
        }

        function clearCameraReleaseTimer() {
          if (state.cameraReleaseTimer) clearTimeout(state.cameraReleaseTimer);
          state.cameraReleaseTimer = null;
        }

        function scheduleCameraRelease() {
          clearCameraReleaseTimer();
          if (!state.cameraStream) return;
          state.cameraReleaseTimer = setTimeout(() => {
            if (state.scanning) return;
            releaseCamera();
          }, CAMERA_WARM_MS);
        }

        function getLiveVideoTrack(stream) {
          const track = stream?.getVideoTracks?.()?.[0];
          if (!track) return null;
          if (track.readyState && track.readyState !== "live") return null;
          return track;
        }

        function getAdvancedCameraConstraints({ torch = false } = {}) {
          const advanced = [
            { focusMode: "continuous" },
            { exposureMode: "continuous" },
            { whiteBalanceMode: "continuous" },
          ];
          if (torch) advanced.push({ torch: true });
          return advanced;
        }

        function buildVideoConstraints({ torch = false } = {}) {
          return {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            advanced: getAdvancedCameraConstraints({ torch }),
          };
        }

        function getActiveVideoTrack() {
          const fromState = getLiveVideoTrack(state.cameraStream);
          if (fromState) return fromState;
          if (window.Quagga?.CameraAccess?.getActiveTrack) {
            try {
              return window.Quagga.CameraAccess.getActiveTrack();
            } catch {
              return null;
            }
          }
          return null;
        }

        function setTorchButton(on) {
          if (!els.btnTorch) return;
          els.btnTorch.classList.toggle("is-active", Boolean(on));
          els.btnTorch.setAttribute("aria-pressed", on ? "true" : "false");
          els.btnTorch.setAttribute("aria-label", on ? "Flashlight on" : "Flashlight off");
        }

        async function applyTorchState(on) {
          const track = getActiveVideoTrack();
          if (!track?.applyConstraints) return false;

          let hasTorch = false;
          try {
            const caps = track.getCapabilities ? track.getCapabilities() : null;
            hasTorch = Boolean(caps?.torch);
          } catch {
            hasTorch = false;
          }
          if (!hasTorch) return false;

          try {
            await track.applyConstraints({ advanced: [{ torch: Boolean(on) }] });
            return true;
          } catch {
            return false;
          }
        }

        async function toggleTorch() {
          const target = !state.torchOn;
          state.torchOn = target;
          setTorchButton(target);

          if (!state.scanning) {
            startScanner();
            await sleep(250);
          }

          const ok = await applyTorchState(target);
          if (!ok && target) {
            // Try restarting with torch preference for stubborn devices
            if (state.scannerEngine === "barcode-detector") {
              try {
                await ensureCameraStream({ forceNew: true });
              } catch {
                // ignore
              }
            } else if (state.scannerEngine === "quagga") {
              stopScanner({ releaseCamera: true, keepTorch: true });
              await sleep(180);
              startScanner();
              await sleep(350);
            }

            const ok2 = await applyTorchState(target);
            if (!ok2) {
              state.torchOn = false;
              setTorchButton(false);
              toast("Flashlight not supported on this device.");
            }
          }
        }

        async function applyBestEffortAutofocus(track) {
          if (!track?.applyConstraints) return;
          const advanced = [];

          try {
            const caps = track.getCapabilities ? track.getCapabilities() : null;
            if (caps?.focusMode?.includes?.("continuous")) advanced.push({ focusMode: "continuous" });
            if (caps?.exposureMode?.includes?.("continuous")) advanced.push({ exposureMode: "continuous" });
            if (caps?.whiteBalanceMode?.includes?.("continuous")) advanced.push({ whiteBalanceMode: "continuous" });
            if (caps?.zoom?.max) {
              const zoomTarget = Math.min(2, caps.zoom.max);
              if (!caps.zoom.min || zoomTarget >= caps.zoom.min) advanced.push({ zoom: zoomTarget });
            }
          } catch {
            // ignore capability errors
          }

          if (!advanced.length) return;
          try {
            await track.applyConstraints({ advanced });
          } catch {
            // ignore constraint errors
          }
        }

        function ensureScannerVideoEl() {
          if (state.cameraVideo && state.cameraVideo.isConnected) return state.cameraVideo;

          const video = document.createElement("video");
          video.setAttribute("playsinline", "");
          video.setAttribute("muted", "");
          video.muted = true;
          video.autoplay = true;

          // Clean slate to avoid stacking old canvases/videos across restarts
          els.scanner.innerHTML = "";
          els.scanner.appendChild(video);

          state.cameraVideo = video;
          return video;
        }

        async function ensureCameraStream({ forceNew = false } = {}) {
          clearCameraReleaseTimer();

          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("CAMERA_UNSUPPORTED");
          }

          // Reuse an existing live stream so the browser doesn't re-prompt.
          if (!forceNew && state.cameraStream && getLiveVideoTrack(state.cameraStream)) {
            const video = ensureScannerVideoEl();
            if (video.srcObject !== state.cameraStream) video.srcObject = state.cameraStream;
            try {
              await video.play();
            } catch {
              // ignore
            }
            return { stream: state.cameraStream, video };
          }

          if (forceNew && state.cameraStream) {
            releaseCamera();
          }

          const requestStream = async (withTorch) => {
            const constraints = {
              audio: false,
              video: buildVideoConstraints({ torch: withTorch }),
            };
            return navigator.mediaDevices.getUserMedia(constraints);
          };

          let stream;
          try {
            stream = await requestStream(state.torchOn);
          } catch (err) {
            if (state.torchOn) {
              stream = await requestStream(false);
            } else {
              throw err;
            }
          }
          state.cameraStream = stream;

          const video = ensureScannerVideoEl();
          video.srcObject = stream;

          try {
            await video.play();
          } catch {
            // iOS may require a user gesture; the Scan FAB is a gesture, so usually fine.
          }

          const track = getLiveVideoTrack(stream);
          await applyBestEffortAutofocus(track);
          if (state.torchOn) {
            const ok = await applyTorchState(true);
            if (!ok) {
              state.torchOn = false;
              setTorchButton(false);
            }
          }

          return { stream, video };
        }

        async function ensureBarcodeDetector() {
          if (state.barcodeDetector) return state.barcodeDetector;
          if (typeof window.BarcodeDetector === "undefined") {
            throw new Error("BARCODE_DETECTOR_UNSUPPORTED");
          }

          const formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

          try {
            state.barcodeDetector = new window.BarcodeDetector({ formats });
          } catch {
            state.barcodeDetector = new window.BarcodeDetector();
          }

          return state.barcodeDetector;
        }

        function handleDetected(raw) {
          const now = Date.now();
          const normalized = normalizeBarcode(raw);
          if (!normalized || normalized.length < 8) return;

          // Basic de-dupe + rate limit
          if (normalized === state.lastCode && now - state.lastDetectedAt < 1600) return;
          if (now - state.lastDetectedAt < 450) return;

          state.lastCode = normalized;
          state.lastDetectedAt = now;

          if (isValidGtin(normalized)) {
            acceptBarcode(normalized);
            return;
          }

          // Accept if we see the same code twice quickly (helps noisy scans / UPC-E)
          if (state.candidateCode === normalized && now - state.candidateAt < 1400) {
            state.candidateCount += 1;
          } else {
            state.candidateCode = normalized;
            state.candidateCount = 1;
            state.candidateAt = now;
          }

          if (state.candidateCount >= 2) {
            acceptBarcode(normalized);
          }
        }

        async function startBarcodeDetector(token) {
          state.scannerEngine = "barcode-detector";

          const { video } = await ensureCameraStream();
          if (!state.scanning || token !== state.scanToken) return;

          const detector = await ensureBarcodeDetector();
          if (!state.scanning || token !== state.scanToken) return;

          setScanPill("Scanning", "Hold steady");

          const loopToken = ++state.detectorToken;

          const loop = async () => {
            if (!state.scanning || token !== state.scanToken || loopToken !== state.detectorToken) return;

            const now = Date.now();
            if (now - (state.detectorLastAt || 0) < DETECT_THROTTLE_MS) {
              requestAnimationFrame(loop);
              return;
            }
            state.detectorLastAt = now;

            try {
              const results = await detector.detect(video);
              if (!state.scanning || token !== state.scanToken || loopToken !== state.detectorToken) return;

              const first = results?.find?.((r) => r?.rawValue) ?? results?.[0];
              const code = first?.rawValue ?? first?.value ?? null;
              if (code) handleDetected(code);
            } catch {
              // ignore per-frame detect errors
            }

            requestAnimationFrame(loop);
          };

          requestAnimationFrame(loop);
        }

        function stopBarcodeDetector() {
          state.detectorToken++;
        }

        function startQuagga(token) {
          if (typeof window.Quagga === "undefined") {
            toast("Scanner library failed to load. Use manual entry.");
            setScanPill("Camera unavailable", "Use manual entry");
            state.scanning = false;
            setFabScanning(false);
            return;
          }

          state.scannerEngine = "quagga";

          // Clean slate to avoid stacking old canvases/videos across restarts
          els.scanner.innerHTML = "";

          const config = {
            inputStream: {
              name: "Live",
              type: "LiveStream",
              target: els.scanner,
              constraints: buildVideoConstraints({ torch: state.torchOn }),
              area: { top: "30%", right: "5%", left: "5%", bottom: "30%" },
            },
            locate: true,
            locator: { patchSize: "medium", halfSample: true },
            frequency: 15,
            numOfWorkers: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
            decoder: {
              readers: ["ean_reader", "ean_8_reader", "upc_reader", "upc_e_reader"],
            },
          };

          window.Quagga.init(config, (err) => {
            if (err) {
              if (token !== state.scanToken) return;
              state.scanning = false;
              setFabScanning(false);
              setScanPill("Camera blocked", "Use manual entry");
              toast("Camera permission denied or unavailable.");
              return;
            }

            // User stopped scan while Quagga was still initializing
            if (!state.scanning || token !== state.scanToken) {
              try {
                window.Quagga.stop();
              } catch {
                // ignore
              }
              state.quaggaReady = false;
              return;
            }

            window.Quagga.start();
            state.quaggaReady = true;
            setScanPill("Scanning", "Hold steady");
            if (state.torchOn) {
              applyTorchState(true);
            }

            window.Quagga.onDetected(onQuaggaDetected);
          });
        }

        function stopQuagga() {
          if (typeof window.Quagga === "undefined") return;

          try {
            window.Quagga.offDetected(onQuaggaDetected);
          } catch {
            // ignore
          }

          if (!state.quaggaReady) return;
          try {
            window.Quagga.stop();
          } catch {
            // ignore
          }
          state.quaggaReady = false;
        }

        function onQuaggaDetected(result) {
          const code = result?.codeResult?.code;
          if (!code) return;
          handleDetected(code);
        }

        function releaseCamera() {
          clearCameraReleaseTimer();

          if (state.cameraVideo) {
            try {
              state.cameraVideo.pause();
            } catch {
              // ignore
            }
            state.cameraVideo.srcObject = null;
          }

          if (state.cameraStream) {
            try {
              state.cameraStream.getTracks().forEach((t) => t.stop());
            } catch {
              // ignore
            }
          }

          state.cameraStream = null;
        }

        function startScanner() {
          if (state.scanning) return;

          clearCameraReleaseTimer();
          ensureSecureHint();
          setScanPill("Starting", "camera...");

          const token = ++state.scanToken;

          state.scanning = true;
          setFabScanning(true);

          if (typeof window.BarcodeDetector !== "undefined") {
            startBarcodeDetector(token).catch(() => {
              if (token !== state.scanToken) return;
              releaseCamera();
              startQuagga(token);
            });
            return;
          }

          startQuagga(token);
        }

        function stopScanner({ releaseCamera: shouldReleaseCamera = false, keepTorch = false } = {}) {
          state.scanToken++;

          const wasScanning = state.scanning;
          state.scanning = false;
          state.scannerEngine = null;

          if (wasScanning) setScanPill("Ready", "Tap Scan to start");
          setFabScanning(false);

          stopBarcodeDetector();
          stopQuagga();
          if (!keepTorch && state.torchOn) {
            state.torchOn = false;
            setTorchButton(false);
            applyTorchState(false);
          }

          if (shouldReleaseCamera) releaseCamera();
          else scheduleCameraRelease();
        }

        // Safety: stop camera when the page is backgrounded/closed.
        window.addEventListener("pagehide", () => stopScanner({ releaseCamera: true }));
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) stopScanner({ releaseCamera: true });
        });

        M.scanner = { ensureSecureHint, setScanPill, startScanner, stopScanner, releaseCamera, toggleTorch };
      })(window.NutriScan);

(function bootModule(M) {
        const { els, state } = M;
        const { showScreen, openModal, closeModal, toast } = M.util;

        // Bottom nav
        document.querySelectorAll(".nav-btn").forEach((b) => {
          b.addEventListener("click", () => {
            const target = b.dataset.screen;
            if (!target) return;
            showScreen(target);
          });
        });

        // FAB (scan / stop)
        els.fab.addEventListener("click", () => {
          showScreen("scan");
          if (state.scanning) M.scanner.stopScanner();
          else M.scanner.startScanner();
        });

        // Manual entry modal
        els.btnManualOpen.addEventListener("click", () => {
          if (state.scanning) M.scanner.stopScanner();
          openModal();
        });
        if (els.btnTorch) {
          els.btnTorch.addEventListener("click", () => M.scanner.toggleTorch());
        }
        els.btnManualClose.addEventListener("click", closeModal);
        els.modalBackdrop.addEventListener("click", closeModal);

        els.manualLookup.addEventListener("click", () => {
          const code = els.manualInput.value;
          closeModal();
          M.api.analyzeBarcode(code, { source: "manual" });
        });

        els.manualInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            els.manualLookup.click();
          }
        });

        els.manualPaste.addEventListener("click", async () => {
          try {
            const t = await navigator.clipboard.readText();
            els.manualInput.value = String(t ?? "").trim();
            toast("Pasted from clipboard.");
          } catch {
            toast("Clipboard not available.");
          }
        });

        // Result / error controls
        els.btnBackToScan.addEventListener("click", () => showScreen("scan"));
        els.btnErrorBack.addEventListener("click", () => showScreen("scan"));
        els.errScanAgain.addEventListener("click", () => {
          showScreen("scan");
          M.scanner.startScanner();
        });

        els.errLookup.addEventListener("click", () => M.api.analyzeBarcode(els.errInput.value, { source: "manual" }));
        els.errInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            els.errLookup.click();
          }
        });

        // History
        els.btnClearHistory.addEventListener("click", () => M.history.clearHistory());

        els.historyStrip.addEventListener("click", (e) => {
          const card = e.target.closest(".hcard");
          if (!card) return;
          const barcode = card.dataset.barcode;
          if (!barcode) return;
          M.api.analyzeBarcode(barcode, { source: "history" });
        });

        // Boot: load history + initial hints
        state.history = M.history.loadHistory();
        M.history.renderHistory();

        const versionEl = document.querySelector("#app-version");
        if (versionEl) versionEl.textContent = String(M.VERSION ?? "");

        const ok = M.scanner.ensureSecureHint();
        if (!ok && location.protocol !== "https:" && location.hostname !== "localhost") {
          M.scanner.setScanPill("Manual entry", "works anywhere");
        }
      })(window.NutriScan);
