# Research: which public receipt datasets can extend our test corpus?

Resolves research ticket #277 under the map #274 (Photos on Expenses and Receipt scanning). Feeds #278, which judges OCR and vision engines (no LLMs) on a private test corpus of photographed till receipts. The owner's own corpus is a set of Portuguese and a few Polish receipts; this note looks for public datasets that can sit next to it.

Researched on 2026-11-13 from dataset cards, repositories, papers and licence texts (linked inline). Nothing here was downloaded into the repo; the corpus stays outside this public repository.

## What the corpus needs

- **Real till receipts photographed with a phone**: skew, perspective, folds, crumples, thermal fade, shadows. Flatbed scans are easier than what a Participant will send.
- **Line-level labels**, because the scan fills **Line items**: item name, quantity, price, discounts, plus the totals. Header-only labels (merchant, date, total) only test part of the job.
- **Latin script**, ideally European: Portuguese and Polish first, then German, Croatian, Spanish, French, Italian. Scanning reads any Latin-script receipt (map #274).
- **A licence that allows private evaluation** and keeping a copy outside the public repo. Owe Yeah is a free public instance run by a one-person company, so "non-commercial" and "research only" terms are a grey zone; this note treats them as not usable.

## Summary

| Dataset | Size | Language / origin | Capture | Line-item labels | Licence | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| [CORD v2](#cord-consolidated-receipt-dataset) | 1,000 public (800/100/100) | Indonesian shops and restaurants | Camera images, cropped (not stated) | Yes: name, count, unit price, price, discount, subtotal, total | CC BY 4.0 | **Pull** |
| [Turkish Receipt Dataset (SCU-CENG)](#turkish-receipt-dataset-scu-ceng) | 1,068 photos + 21,315 OCR crops | Turkish, many sectors | Mobile phones, blur, skew, fading, bending, tearing | Partly: item name, item tax rate, item amount, totals (no quantity) | MIT | **Pull** |
| [WildReceipt](#wildreceipt) | 1,740 (1,268/472) | English (non-English removed) | In the wild, non-front views, folds | Yes: product item, quantity, price, subtotal, tax, tips, total (key/value boxes) | Not stated | Pull only if the owner accepts the licence gap |
| [NOVA IMS Portuguese invoices and receipts](#nova-ims-portuguese-invoices-and-receipts) | 1,003 (813 + 190) | Portuguese | Not stated | No: seller, NIF, date, total, tax, reference | CC BY 4.0 | **Pull** (header and total checks only) |
| [Synthetic Receipts OCR](#synthetic-receipts-ocr-de-it-fr-uk-us) | 32,000 (30,000/2,000) | DE, IT, FR, UK, US (synthetic) | Rendered + simulated photo degradation | Yes: name, qty, unit price, total, tax rate, VAT classes, totals | Apache-2.0 | Optional extra layer, never the judge |
| [SROIE](#sroie-icdar-2019) | 1,000 (600/400) | English, Malaysia | Flatbed scans | No: company, address, date, total | CC BY 4.0 per mirrors; source page unreachable | Skip (or tiny baseline) |
| [ExpressExpense SRD](#expressexpense-sample-receipt-dataset-srd) | 200 | English, US restaurants | Scans | None (images only) | MIT | Skip |
| [Neytandinn Receipts](#neytandinn-receipts-icelandic) | 1,756 receipts, 29,199 Line items | Icelandic, one chain (Bónus) | Not stated | Yes: text, unit price, quantity (weighed goods fractional), line total | "MIT", but scraped and "research purposes only" | Open question |

Not usable or not relevant: [the rest](#checked-and-ruled-out) (AMuRD, CORU/ReceiptSense, UniData grocery sample, Croatian Roboflow project, PorTEXTO, Find it again!, Italian receipts on GitHub, MC-OCR, UIT-MLReceipts).

**No public Polish receipt dataset turned up**, and the only Portuguese one is invoice-heavy with header labels. The owner's own Polish and Portuguese receipts stay the core of the corpus; public sets extend it with line-item structure (CORD, WildReceipt) and real phone-photo damage (Turkish set).

## Datasets worth pulling

### CORD (Consolidated Receipt Dataset)

- **What**: receipts from Indonesian shops and restaurants. Over 11,000 collected, **1,000 public**: 800 train, 100 dev, 100 test ([clovaai/cord README](https://github.com/clovaai/cord); [HF cord-v2 card](https://huggingface.co/datasets/naver-clova-ix/cord-v2)).
- **Labels**: one JSON per receipt with `valid_line` (word quads, text, row id, category, group id), `roi` and `meta`; the v2 `ground_truth` has a `gt_parse` tree such as `{"menu": [{"nm": "Nasi Campur Bali", "cnt": "1 x", "price": "75,000"}], "sub_total": ..., "total": ...}` ([HF card](https://huggingface.co/datasets/naver-clova-ix/cord-v2)). The classes cover what the Receipt model needs: `menu.nm`, `menu.cnt`, `menu.unitprice`, `menu.price`, `menu.discountprice`, `menu.itemsubtotal`, `sub_total.discount_price`, `sub_total.subtotal_price`, tax and service, `total.total_price`, cash, change ([README](https://github.com/clovaai/cord)). Store and payment info was removed from the public set for legal reasons.
- **Capture**: the README does not say whether the images are phone photos or scans. Image widths range from 204 to 3,020 px ([HF card](https://huggingface.co/datasets/naver-clova-ix/cord-v2)), which suggests crops of camera images; check on a sample after pulling.
- **Licence**: "This work is licensed under a Creative Commons Attribution 4.0 International License" ([README](https://github.com/clovaai/cord)). Private use and storage are fine; attribution needed if we ever redistribute.
- **Get it**: `naver-clova-ix/cord-v2` on Hugging Face (2.31 GB parquet, all splits).
- **Why**: the only real-receipt public set with full Line item structure including per-item and receipt-level discounts. Amounts use Indonesian thousands separators (`75,000`), which also tests number parsing.

### Turkish Receipt Dataset (SCU-CENG)

- **What**: **1,068 Turkish receipt images "captured using various mobile devices under different conditions"**, from various sectors across Turkey, with "blurriness, skewness, and low resolution" and "fading, bending, and tearing due to storage conditions" ([README](https://github.com/SCU-CENG/Receipt-Dataset)). A second set has 21,315 line crops with transcripts (Tesseract training format).
- **Labels**: bounding boxes in one COCO-like JSON for nine classes: Company Name, Date, Time, ID, Item Name, Item Tax Rate, Item Amount, Total Tax, Total Amount; plus a key-information file per image. No quantity or unit price class, so Line items are name + amount only. 80/20 split.
- **Licence**: MIT ([LICENSE](https://github.com/SCU-CENG/Receipt-Dataset/blob/main/LICENSE)). The file's copyright line still reads "Matterport, Inc." (copied boilerplate), but the README states the project is MIT-licensed.
- **Get it**: clone the GitHub repo (about 3.7 GB).
- **Why**: the closest public match to real phone photos of till receipts, and Latin script with diacritics (ç, ğ, ı, ş). Turkish till receipts print VAT per line (`%10`, `%20`), similar to Portuguese and Polish ones.

### WildReceipt

- **What**: **1,740 receipt images** (1,268 train, 472 test; the paper's own table says 1,768) and 68,975 text boxes ([paper, arXiv 2103.14470](https://ar5iv.labs.arxiv.org/html/2103.14470)). Collected "in the wild", "of non-front views and possibly with folds"; non-English receipts were filtered out.
- **Labels**: 25 classes: key/value pairs for store name, store address, telephone, date, time, **product item, product quantity, product price**, subtotal, tax, tips, total, plus Others. MMOCR's KIE JSON lines: `file_name`, `height`, `width`, `annotations` with `box`, `text`, `label` ([MMOCR dataset zoo](https://mmocr.readthedocs.io/en/dev-1.x/user_guides/data_prepare/datasetzoo.html)).
- **Licence**: **not stated**. MMOCR's metafile lists the licence as "N/A" ([metafile](https://github.com/open-mmlab/mmocr/blob/main/dataset_zoo/wildreceipt/metafile.yml)); the paper only says it "will be publicly released". No licence means no explicit grant.
- **Get it**: `https://download.openmmlab.com/mmocr/data/wildreceipt.tar` (185 MB, live on 2026-11-13).
- **Why**: real photos with line-level boxes; English only.

### NOVA IMS Portuguese invoices and receipts

- **What**: two Zenodo records by Francisco Cruz and Mauro Castelli (NOVA IMS, Lisbon): **813 images** of invoices and receipts "from a private company, written in Portuguese" ([Zenodo 6371710](https://zenodo.org/records/6371710)), and **190 personal invoices and receipts** of one author ([Zenodo 7213544](https://zenodo.org/records/7213544)). The same 1,003 images are mirrored on [Hugging Face](https://huggingface.co/datasets/Francisco-Cruz/InvoicesReceiptsPT) (card says Apache-2.0; the Zenodo originals say CC BY 4.0, so cite Zenodo).
- **Labels**: one JSON per document with seller name, seller address, seller tax id (NIF), buyer tax id, date, total, tax amount, document reference. **No Line items.**
- **Capture**: not stated; the country is not stated either, but the authors and the NIF fields point to Portugal.
- **Licence**: CC BY 4.0 (both records).
- **Get it**: Zenodo zips (410 MB + 115 MB images, under 400 kB of JSON).
- **Why**: the only European Portuguese public set. Useful for date, total, VAT and merchant reading on Portuguese layouts; mixed with A4 invoices, so filter to till receipts by hand.

### Synthetic Receipts OCR (DE, IT, FR, UK, US)

- **What**: **32,000 synthetic thermal receipts** (30,000 train, 2,000 eval) in five Latin-script locales, each a clean render plus a "photo-degraded twin" (perspective, uneven lighting, shadow bands, thermal fade, noise, blur, JPEG) ([HF card](https://huggingface.co/datasets/albertobarnabo/synthetic-receipts-ocr)).
- **Labels**: full text, exact word boxes, and `fields` with merchant, VAT id, date, time, receipt number, line items (name, qty, unit price, total, tax rate), subtotal, per-class VAT (`ENTH. MwSt 7%`, `DI CUI IVA 22%`), total, payment, change. "Every number on every receipt adds up."
- **Caveats** (from the card): monospace thermal style only, no crumpling, logos or barcodes, simulated degradation, "transfer to real receipt photos is unmeasured". No mention of discounts or weighed goods.
- **Licence**: Apache-2.0 (product names from Amazon ESCI, Apache-2.0; fonts OFL).
- **Get it**: Hugging Face parquet, about 4.1 GB; a locale-filtered slice of the eval split is enough.
- **Why**: German, Italian and French layouts with exact line-level truth. Good for a sanity layer, but an engine should be judged on real photos.

## Datasets that don't add much

### SROIE (ICDAR 2019)

- **What**: 1,000 **scanned** receipts, 600 train/val and 400 test in the paper; "some sensitive fields ... are blurred" ([competition report](https://ar5iv.labs.arxiv.org/html/2103.10213)). English receipts from Malaysia (the paper does not name the country; the receipts carry RM amounts and Malaysian addresses).
- **Labels**: word boxes with transcripts (`x1,y1,...,x4,y4,text`) and four key fields per receipt: company, address, date, total ([zzzDavid/ICDAR-2019-SROIE](https://github.com/zzzDavid/ICDAR-2019-SROIE), [Voxel51 card](https://huggingface.co/datasets/Voxel51/scanned_receipts)). No Line items. The original release has known label mistakes (same repo).
- **Licence**: CC BY 4.0 per MMOCR's [metafile](https://github.com/open-mmlab/mmocr/blob/main/dataset_zoo/sroie/metafile.yml) and the Voxel51 mirror. The organisers' page ([rrc.cvc.uab.es](https://rrc.cvc.uab.es/?ch=13)) needs registration and failed TLS verification during this research, so the licence is **not confirmed at the source**.
- **Verdict**: flatbed scans and header-only labels. Skip, or keep a handful only to compare with published engine numbers.

### ExpressExpense Sample Receipt Dataset (SRD)

- 200 restaurant receipt images, described as scanned, no label files; "free for use under The MIT License (MIT)", cite ExpressExpense.com ([page](https://expressexpense.com/blog/free-receipt-images-ocr-machine-learning-dataset/); zip 19 MB, live on 2026-11-13). US English. We would have to label it ourselves. Skip.

### Neytandinn Receipts (Icelandic)

- **What**: 1,756 Bónus receipts with **29,199 Line items** (`text`, `unit_price`, `quantity`, `line_total`; weighed goods have fractional quantities such as 0.812), plus chain, shop, date, time and total ([HF card](https://huggingface.co/datasets/Sigurdur/neytandinn-receipts)). Icelandic is Latin script with ð, þ, æ, ö.
- **Licence**: tagged MIT, but the card says "**For research purposes only**", and the data was **scraped** from neytandinn.is, a crowdsourced price-comparison site run by Strimillinn ehf. The scraper can't grant rights it doesn't hold, so the MIT tag is not a reliable grant.
- **Verdict**: the richest real Line item labels found, including weighed goods, but the licence is shaky. Open question for the owner.

## Checked and ruled out

- **AMuRD** ([HF](https://huggingface.co/datasets/abdoelsayed/AMuRD)): 47,720 Arabic/English samples, non-commercial research only by application form; the HF repo holds no images.
- **CORU / ReceiptSense** ([HF](https://huggingface.co/datasets/abdoelsayed/CORU)): 20,000 receipts, CC BY 4.0, but Arabic-English; outside the Latin-script focus.
- **UniData "OCR Receipts from Grocery Stores"** ([HF](https://huggingface.co/datasets/UniqueData/ocr-receipts-text-detection)): a CC BY-NC-ND sample of a paid dataset; four box classes (item, store, date_time, total).
- **Croatian receipts on Roboflow Universe** ([project](https://universe.roboflow.com/my-workspace-ednk1/croatian-receipts)): 25 promising classes (ARTICLE_NAME, ARTICLE_SINGLE_PRICE, ARTICLE_FULL_PRICE, ISSUER_OIB, TAX_RATE_STANDARD ...), CC BY 4.0, but the listing says "This project has no images available to display". The page refused automated fetches (HTTP 403), so this comes from search snippets only.
- **PorTEXTO** ([HF](https://huggingface.co/datasets/amalia-llm/PorTEXTO), [arXiv 2606.19096](https://arxiv.org/abs/2606.19096)): European Portuguese OCR benchmark (handwritten, in the wild, synthetic), question/answer labels, no receipt subset, CC BY-NC 4.0.
- **Find it again!** ([L3i](https://l3i-share.univ-lr.fr/2023Finditagain/index.html)): 988 receipts for forgery detection, derived from SROIE (not French), no licence stated. The older French "Find it!" (2018) set's page was not reachable.
- **ITA-receipts-DATASET** ([GitHub](https://github.com/95gas/ITA-receipts-DATASET)): 186 Italian receipt images (137 train, 49 val) with SROIE-style labels (company, date, address, total), **no licence file**, so all rights reserved.
- **MC-OCR 2021** ([preprint](https://people.cs.umu.se/sonvx/files/MCOCR_Preprint.pdf)) and **UIT-MLReceipts**: Vietnamese (and English) mobile-captured receipts, 2,436 and 2,147 images; licence terms not found.
- **Polish**: searches in English and Polish ("paragon", "paragony fiskalne", Hugging Face name search) found no public dataset of Polish till receipts.

## Recommendation for the corpus

1. **Pull CORD v2 test (100) and dev (100)** as the line-item benchmark: it is the only real set whose labels map almost one to one onto Line items, Line discounts and totals.
2. **Pull the Turkish set's 20% test split (about 214 photos)** for real phone-photo damage and per-line VAT layouts.
3. **Pull the NOVA IMS till receipts** (hand-filtered from the 1,003 images) for Portuguese date, total and VAT checks.
4. **Optionally a few hundred Synthetic Receipts OCR eval rows** for DE, IT and FR, reported separately from the real sets.
5. Keep SROIE and ExpressExpense out; WildReceipt and Neytandinn only if the owner accepts their licence gaps.
6. Store every pulled set next to the private corpus with its source URL, version or commit, and licence text, so attribution is ready if anything is ever shared.

Label formats differ (CORD `gt_parse` tree, COCO-like boxes, MMOCR KIE lines, per-document JSON), so #278 needs a small adapter per dataset into one comparison format, scored per field (Line item name, quantity, price, discount, total) rather than per box.

## Open questions

- **Licence grey zone**: is evaluation for a free public product "non-commercial" enough for NC or research-only sets (WildReceipt has no licence at all; Neytandinn says research only)? This note assumes not.
- **Polish gap**: with no public Polish set, should the owner collect more Polish receipts (or ask friends) before #278 runs, so Polish is not judged on a handful of samples?
- **Header vs Line items**: the Portuguese set only tests header fields and totals. Is that enough for Portuguese, or should the owner's Portuguese receipts get line-level labels first?
