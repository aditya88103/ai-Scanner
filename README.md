# NutriScan

NutriScan is a mobile-first barcode scanner that pulls product data from Open Food Facts and shows a simple nutrition score (0-10).


## Features
- Fast live scanning (BarcodeDetector when available, with Quagga fallback)
- Flashlight toggle (when supported by your device/browser)
- Manual barcode entry (EAN/UPC)
- Nutrition score (0-10) with a quick, explainable breakdown
- Product details + nutrition table + ingredients/allergen highlights (only shows fields that exist)
- Local scan history (saved in your browser; no account)

## How it works
1. Scan a barcode (or enter it manually).
2. NutriScan fetches product data from Open Food Facts.
3. It computes a simple score (0-10) using available nutrition facts + Nutri-Score grade (when present).

This is not medical advice. Always check the label and your dietary needs.

## Data Source
NutriScan uses Open Food Facts (community-powered). Coverage varies, so some Indian products may be missing or incomplete.

If a product is missing, you can help everyone by adding/improving it on Open Food Facts.

## Privacy
- No login / no account.
- Camera runs only while you are on the Scan screen.
- History is stored locally (browser `localStorage`) on your device.

## Usage
1. Open the live demo link.
2. Tap **Scan** to start the camera and allow permission.
3. Hold steady over the barcode (good light helps a lot).
4. Use the flashlight button in low light (if supported).
5. Recent scans appear in **History**.

## Supported barcodes
- EAN-13, EAN-8, UPC-A, UPC-E (support varies by device/browser)

## Troubleshooting
- Camera works only on HTTPS (GitHub Pages is HTTPS). If scan doesn’t start:
  - Allow camera permission in your browser settings.
  - Try Chrome on Android (best support in most phones).
- Flashlight works only if your phone + browser supports torch control.
- “Not found” usually means the product is not in Open Food Facts yet, or details are incomplete.

## Tech stack
- Vanilla HTML/CSS/JS
- BarcodeDetector API (fast path on supported browsers)
- QuaggaJS (fallback scanner)
- Open Food Facts API (India + World endpoints)

## Notes
- Flashlight depends on device + browser support.
- This project is client-side only (runs in the browser); no user accounts.
- Data comes from Open Food Facts and may be incomplete.

## Roadmap
- Multi-language UI (Hindi + English)
- Better product insights for Indian brands
- Offline-friendly history + caching
