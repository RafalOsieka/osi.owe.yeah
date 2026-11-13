# Research: which free or cheap engines can read a receipt into Line items?

Resolves the research ticket "Which free or cheap engines can read a receipt into Line items?" (#276) on the wayfinder map "Photos on Expenses and Receipt scanning" (#274).
It records facts and a shortlist. The engine and worker are chosen in #283, after a run on the test corpus (which stays out of this repo).

Researched on 2026-11-13. Prices, licences and model versions change often. Re-check anything marked _unverified_ before building on it.

Constraints from the map: no LLMs. Free or cheap. Any Latin-script receipt (Portuguese, Polish, German, Croatian, Czech, French, ...). A self-hosted engine runs as an optional worker container on a modest x86 server, CPU only, and takes jobs from a PostgreSQL queue. A Draft can take minutes to read. A hosted API receives the Photo, so it is a GDPR processor.

## TL;DR

- **No engine returns our Receipt.** Not one of them (hosted or self-hosted) types Deposits, Deposit refunds or voids. Only one (Veryfi) has per-Line item discounts. Every hosted API returns money as floats. So **our own Receipt parser is needed in every option**. The engines differ only in how good the text and boxes they hand it are, and in how much of the structure they guess for us.
- **Self-hosted OCR is good enough to try and cheap to run.**
  - PaddleOCR's PP-OCRv6 (June 2026, Apache-2.0 code and weights) reads 46 Latin-script languages with one model.
  - On ONNX Runtime it takes well under a second per image on a server CPU, without PyTorch or Paddle.
  - docTR through OnnxTR (Apache-2.0) has the best published receipt (CORD) numbers among open engines and a word/line/block tree. Its multilingual model lacks Croatian `đ`.
- **Self-hosted document-understanding models are not usable now.**
  - The LayoutLM family and PaddleOCR's KIE weights are CC BY-NC-SA (non-commercial).
  - Donut is MIT, but it is trained on Indonesian receipts, its vocabulary was pruned for English/CJK, and it has no merchant, date or Deposit fields.
  - LiLT (MIT) could work after fine-tuning on roughly 500-1,000 labelled European receipts, which don't exist publicly.
  - Surya and PaddleOCR-VL are now VLMs, so they are excluded.
- **Hosted:** Azure Document Intelligence `prebuilt-receipt` is the only receipt API that:
  - lists all our languages for thermal receipts
  - returns unit price and quantity per Line item
  - is not generative
  - processes in the resource's region
  - keeps data 24 h at most

  It gives 500 free pages a month, then $10 per 1,000. Raw OCR from Google Cloud Vision (EU endpoint) or Azure Read costs $1.50 per 1,000.
  - AWS Textract AnalyzeExpense reads English receipts only.
  - Google's Expense Parser lacks pl, hr and cs.
  - Veryfi trains on customer data by default.
  - Mindee's v2 models probably involve an LLM.

- **Shortlist for the corpus run:**
  1. PaddleOCR PP-OCRv6 small on ONNX (via RapidOCR)
  2. OnnxTR
  3. Azure `prebuilt-receipt` as the hosted reference

  All three feed the same parser. See [Shortlist](#shortlist).

## 1. What the Receipt model needs from an engine

From `GLOSSARY.md`, a read Receipt needs:

- Line items in printed order: name, unit price, whole-number quantity, and line total. Weighed goods count as one unit at the line price.
- A discount on a Line item, and a Receipt discount.
- Deposits per unit on the Line item they belong to, and Deposit refunds as negative lines.
- Voids folded in.
- The printed total, so the Subtotal can be checked against it.
- Merchant, date, time and currency for the Expense.

Each engine below is judged on how much of that it gives, and how much the parser must add.

## 2. Self-hosted OCR plus our own parser

| Engine                              | Output                                                                                                  | One model for pl/hr/pt/de/cs/fr?                                                                            | CPU time (published)                                                        | Footprint                                                            | Licence (code / weights)                                           | Latest release                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| **PaddleOCR 3.7, PP-OCRv6**         | Text lines with polygons, boxes and scores                                                              | Yes, 46 Latin languages (PP-OCRv5 `latin_*_rec` also covers them)                                           | small 0.59-0.79 s, tiny 0.20-0.32 s per image (Xeon 8350C, end to end)      | ONNX Runtime about 28 MB, models 2-73 MB; the Paddle wheel is 195 MB | Apache-2.0 / Apache-2.0                                            | v3.7.0, 2026-06-11                                         |
| **RapidOCR 3.10**                   | PaddleOCR models on ONNX Runtime/OpenVINO                                                               | As PaddleOCR                                                                                                | As PaddleOCR on ONNX                                                        | onnxruntime only                                                     | Apache-2.0 / Apache-2.0                                            | v3.10.0, 2026-10-08                                        |
| **docTR 1.1 / OnnxTR 0.9** (Mindee) | Page, block, line and word tree with geometry and confidence. Rotated pages, optional layout and tables | Multilingual PARSeq covers pl/cs/pt/de/fr, **not Croatian `đ`**. The default models use a French vocabulary | CORD: docTR 0.60 s, OnnxTR 0.25 s, OnnxTR 8-bit 0.14 s per page (i7-14700K) | OnnxTR needs onnxruntime only, recogniser 97 MB                      | Apache-2.0 / Apache-2.0                                            | docTR v1.1.0 2026-08-21, OnnxTR v0.9.0 2026-08-24          |
| **Tesseract 5.5**                   | Blocks, lines and words with boxes and confidence (TSV/hOCR)                                            | Combined language packs (`pol+hrv+...`), or `script/Latin` (89-101 MB)                                      | about 0.5 s per page on CORD (i7-14700K)                                    | Native binary, 1-12 MB per language                                  | Apache-2.0 / Apache-2.0                                            | 5.5.4, 2026-10-28                                          |
| **EasyOCR 1.7**                     | Box, text and confidence per text piece                                                                 | Yes, `latin_g2`                                                                                             | Not published                                                               | PyTorch                                                              | Apache-2.0 / Apache-2.0                                            | v1.7.2, 2024-09-24 (releases stalled)                      |
| Surya 0.24                          | Now a 689M "OCR and layout VLM"                                                                         | -                                                                                                           | about 39 s per page on an M4 Max                                            | -                                                                    | Apache-2.0 / modified OpenRAIL-M with a $5M revenue or funding cap | **Excluded**: a VLM, and the weights licence restricts use |
| PaddleOCR-VL                        | 0.9B VLM with an ERNIE-4.5 language model                                                               | -                                                                                                           | -                                                                           | -                                                                    | Apache-2.0                                                         | **Excluded**: a VLM                                        |

Notes:

- **Accuracy on receipts.**
  - The only receipt numbers in the projects' own docs are docTR's on CORD:
    - 95.5-95.6% exact match on recognition
    - end to end (db_resnet50 + parseq): recall 85.9 / precision 80.1, against Azure's 89.6 / 88.9 in the same table

    Source: https://mindee.github.io/doctr/using_doctr/using_models.html

  - A single vendor run on SROIE (English receipts, code not public) gives the character error rate as docTR 19.7%, PaddleOCR 20.5%, EasyOCR 28.3% and Tesseract 33.6%: https://imagetotable.ai/references/receipt-ocr-benchmark-results. Treat it as indicative only.
  - PP-OCRv6 medium reports 83.2% weighted recognition accuracy against 78.1% for PP-OCRv5_server. Its test scenes include dot-matrix print but not receipts: https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html
  - The language list (Polish, Croatian, Czech, Portuguese, German and French among the 46 Latin languages) is in Table 10 of the PP-OCRv6 report: https://arxiv.org/html/2606.13108. For PP-OCRv5's Latin model, see https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html (84.7% on a 3,111-image Latin test set).
  - SROIE is English and CORD is Indonesian. Nothing public measures these engines on Polish, Croatian or Portuguese receipts, which is why the corpus run decides.
- **CPU on a modest server.**
  - All published timings come from larger Xeon or i7 machines. On 4 vCPU expect roughly 1-5 s per receipt for PP-OCRv6 small or OnnxTR (an estimate; _unverified_). That is far inside "minutes".
  - Paddle's CPU wheel needs AVX (no AVX-512): https://paddlepaddle.org.cn/documentation/docs/en/install/pip/linux-pip_en.html. The ONNX route avoids the Paddle wheel entirely.
- **Phone-photo preprocessing.**
  - PaddleOCR ships a page orientation model (7 MB), UVDoc unwarping for curled paper (30 MB, Apache-2.0) and a text-line orientation model: https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html, https://huggingface.co/PaddlePaddle/UVDoc
  - docTR has `straighten_pages` and rotated boxes.
  - A plain OpenCV crop also works: find the largest quadrilateral, apply a perspective warp, then stretch the contrast for faded thermal print.
- **Node.js.** The app is TypeScript, but the worker need not be.
  - `tesseract.js` v7 (Apache-2.0, WASM) runs in Node: https://github.com/naptha/tesseract.js
  - For PaddleOCR models on `onnxruntime-node` there is only a small third-party package, `ppu-paddle-ocr` (MIT): https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr
  - OnnxTR has no Node binding. Porting its pre- and post-processing to TypeScript would be our work.
  - A thin Python worker on RapidOCR or OnnxTR is the safer default.
- **Licences of the excluded parts.**
  - PP-StructureV3 is classic modules except its optional PP-Chart2Table (a 0.58B multimodal model), so keep that off: https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PP-StructureV3.html
  - Surya's weights licence bars entities above $5M revenue or funding and competitors of Datalab: https://github.com/datalab-to/surya/blob/master/MODEL_LICENSE

Sources:

- https://github.com/PaddlePaddle/PaddleOCR/releases
- https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec
- https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec
- https://github.com/RapidAI/RapidOCR
- https://github.com/mindee/doctr/releases
- https://github.com/felixdittrich92/OnnxTR
- https://huggingface.co/Felix92/onnxtr-parseq-multilingual-v1/raw/main/config.json (vocabulary without `đ`)
- https://github.com/mindee/doctr/blob/main/doctr/datasets/vocabs.py (the `multilingual` vocabulary has `đ`, so a fine-tune is possible)
- https://github.com/tesseract-ocr/tesseract/releases
- https://tesseract-ocr.github.io/tessdoc/Data-Files.html
- https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html
- https://github.com/JaidedAI/EasyOCR
- https://github.com/JaidedAI/EasyOCR/blob/master/easyocr/config.py
- https://github.com/datalab-to/surya/releases
- https://huggingface.co/datalab-to/surya-ocr-2.5

## 3. Self-hosted document-understanding models (CPU)

| Model                                | Output                                                                                                                                                 | Receipt accuracy                                       | Languages out of the box                                                            | Size                    | Licence (code / weights)                       | Fit                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Donut `donut-base-finetuned-cord-v2` | CORD JSON straight from the image: `menu.nm`, `menu.cnt`, `menu.unitprice`, `menu.price`, `menu.discountprice`, `void_menu.*`, `subtotal.*`, `total.*` | CORD F1 84.1, TED accuracy 90.9 (paper); 91.3 (README) | Pretrained on English plus synthetic EN/ZH/JA/KO. Fine-tuned on Indonesian receipts | 143M parameters, 806 MB | MIT / MIT                                      | No merchant, date, currency or Deposit fields. Needs pretraining and fine-tuning for our languages |
| LayoutLMv3 / v2 / LayoutXLM          | A label per OCR token                                                                                                                                  | CORD F1 96.56 (v3 base)                                | English (v2, v3), multilingual (XLM)                                                | 133-300M                | **CC BY-NC-SA 4.0**                            | Non-commercial licence: unusable                                                                   |
| LiLT `lilt-infoxlm-base`             | A label per OCR token                                                                                                                                  | CORD F1 96.07                                          | Text half multilingual (InfoXLM), layout half language-independent                  | 846 MB                  | MIT / MIT (InfoXLM's own licence _unverified_) | Only after fine-tuning on our own labelled receipts                                                |
| PaddleOCR KIE (VI-LayoutXLM SER/RE)  | Entities and key-value links                                                                                                                           | Chinese XFUND forms only                               | Chinese                                                                             | -                       | Apache-2.0 / docs say CC BY-NC-SA 4.0          | Unusable, and possibly dropped in 3.x                                                              |
| Florence-2-base                      | OCR text with regions, no receipt fields                                                                                                               | None published                                         | English only, per Microsoft staff                                                   | 0.23B                   | MIT / MIT                                      | A generative vision-language model, and it adds nothing over PP-OCR                                |
| PP-ChatOCRv4                         | Q&A extraction                                                                                                                                         | -                                                      | -                                                                                   | -                       | -                                              | **Excluded**: built on the ERNIE 4.5 LLM                                                           |

Notes:

- **Donut.**
  - The decoder starts from `asian-bart-ecjk`, an mBART pruned to an English/Chinese/Japanese/Korean vocabulary of 57k pieces. Whether it still has `ł`, `ą`, `ž`, `đ` or `ã` is _unverified_, and encoding a few receipt lines with its tokenizer would settle it.
  - A new language means SynthDoG pretraining plus a labelled set, on rented GPUs. Upstream pretraining took 64 A100s for about 2.5 days.
  - The last release was in Nov 2022.
  - Sources: https://arxiv.org/html/2111.15664v5, https://github.com/clovaai/donut, https://github.com/hyunwoongko/asian-bart, https://huggingface.co/naver-clova-ix/donut-base-finetuned-cord-v2, https://discuss.huggingface.co/t/finetune-donut-with-new-tokenizer/30567
- **LayoutLM family licences.**
  - https://huggingface.co/microsoft/layoutlmv3-base
  - https://huggingface.co/microsoft/layoutlmv2-base-uncased
  - https://huggingface.co/microsoft/layoutxlm-base

  Whether a free public service run by a one-person company counts as "non-commercial" is at best a grey area, so these are treated as unusable.

- **LiLT.**
  - Code and weights are MIT: https://github.com/jpWang/LiLT, https://huggingface.co/SCUT-DLVCLab/lilt-infoxlm-base
  - It was reported across 8 languages: https://arxiv.org/abs/2202.13669
  - The published CORD score uses the dataset's own ground-truth OCR, so real Photos would score lower: https://arxiv.org/html/2204.08387
  - The CORD fine-tune used 800 training receipts.
- **PaddleOCR KIE.** https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.7/ppstructure/kie/README.md
- **Florence-2.** https://huggingface.co/microsoft/Florence-2-base, https://huggingface.co/microsoft/Florence-2-large-ft/discussions/12
- **Receipt datasets.**
  - CORD v2: 1,000 Indonesian receipts, CC BY 4.0, the best schema for Line items and voids: https://github.com/clovaai/cord
  - SROIE: 4 fields only, English.
  - `kassenzettel-synth`: synthetic German receipts, MIT: https://huggingface.co/datasets/nimalu/kassenzettel-synth
  - No open, labelled Polish, Portuguese or Croatian receipt dataset was found.

**Verdict.**

- Nothing here works out of the box for us.
- The only licence-clean paths need fine-tuning on a labelled European receipt set that doesn't exist yet:
  - OCR feeding LiLT, which is cheap on CPU
  - Donut, which needs GPU rental and a tokenizer check first
- Until such a set exists, OCR plus a rule-based Receipt parser is the realistic option.

## 4. Hosted receipt APIs

| Provider / product                                                       | Line item fields                                                                                   | Our languages (pt, pl, de, hr, cs, fr)                       | Free tier                                              | Price per 1,000                               | EU processing                        | Retention                                                          | Trains on customer data                                         | Generative?                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Azure Document Intelligence `prebuilt-receipt`** (v4.0, 2024-11-30 GA) | Description, Quantity, Price (unit), TotalPrice, ProductCode. No discount                          | **All six** for thermal receipts                             | F0: 500 pages/month                                    | $10 (S0, West Europe)                         | Yes, in the resource's region        | Input and result kept 24 h, or deleted earlier through an API call | Not stated on the Document Intelligence privacy page (see note) | No                                                                                  |
| Google Document AI Expense Parser                                        | description, amount, product_code. quantity only in v1.3.2 (RC). No unit price, no discount        | de, fr, pt (v1.4), **no pl, hr or cs**                       | None                                                   | $100                                          | `eu` location                        | Online: in memory only                                             | No                                                              | No                                                                                  |
| **Google Cloud Vision** `DOCUMENT_TEXT_DETECTION` (raw OCR)              | None: text and blocks only                                                                         | Broad OCR coverage                                           | 1,000 units/month                                      | $1.50                                         | `eu-vision.googleapis.com`           | Online: not saved                                                  | No                                                              | No                                                                                  |
| Azure Read (raw OCR)                                                     | None: text, lines and words                                                                        | Broad                                                        | Within F0                                              | $1.50 (falling to $0.60)                      | As above                             | As above                                                           | As above                                                        | No                                                                                  |
| AWS Textract AnalyzeExpense                                              | ITEM, QUANTITY, PRICE, UNIT_PRICE, EXPENSE_ROW. Summary has DISCOUNT, TOTAL, SUBTOTAL, VENDOR_NAME | **English only** for receipts                                | 100 pages/month for 3 months, plus the new credit plan | $10                                           | Frankfurt, Ireland, Paris and others | Not documented                                                     | **Yes, unless opted out**                                       | No                                                                                  |
| Mindee v2 Receipt (France)                                               | description, quantity, unit_price, total_price                                                     | "Any printed document"                                       | 200 credits within 14 days (trial only)                | about €7.3 (Starter €44/month, billed yearly) | "Europe" zone, Pro plan and up       | 12 h default (1-24 h)                                              | No                                                              | **Probably partly**: v2 documents generative LLM features; ask before relying on it |
| Veryfi (US)                                                              | description, quantity, price, total, **discount**, type, sku                                       | All six                                                      | 100 documents/month                                    | $80 ($500/month minimum)                      | AWS US or Ireland                    | No fixed period stated                                             | **Yes, unless opted out**                                       | Says "non-generative"                                                               |
| Taggun / Tabscanner                                                      | Line items (details _unverified_)                                                                  | _unverified_                                                 | 1,000 scans in a 30-day trial / 200 credits a month    | $56 / $60-80                                  | Not stated                           | Taggun keeps files **3 years** unless `incognito: true`            | Not stated                                                      | Not stated                                                                          |
| OCR.space (raw OCR)                                                      | None                                                                                               | pl and cs dedicated; hr through the generic Latin recogniser | 25,000 requests/month, 1 MB files                      | PRO $30/month                                 | No region choice                     | Not clearly stated                                                 | Not stated                                                      | _unverified_                                                                        |

Notes:

- **Azure Document Intelligence.**
  - The receipt fields are MerchantName, MerchantPhoneNumber, MerchantAddress, TransactionDate, TransactionTime, Subtotal, TotalTax, Tip, Total, Items, Payments, TaxDetails and CountryRegion: https://github.com/Azure-Samples/document-intelligence-code-samples/blob/main/schema/2024-11-30-ga/receipt.md
  - The thermal-receipt language list includes pt, pl, de, hr, cs and fr, plus about 110 others. This was checked on 2026-11-13: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/prebuilt?view=doc-intel-4.0.0
  - Data handling, also checked on 2026-11-13: https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/document-intelligence/data-privacy-security
    - Data is "processed in the same region where the Document Intelligence resource was created".
    - Input and results are "stored temporarily in Azure Storage in the same region".
    - Both are deleted "24 hours after an analysis operation completes", or at once through **Delete Analyze Result**.
  - That page says nothing about training. The processor terms are the Microsoft Products and Services DPA, which limits processing to providing the service: https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA. Whether Document Intelligence is in the EU Data Boundary is _unverified_.
  - Pricing:
    - F0 has 500 free pages a month and reads only the first 2 pages, 4 MB files at most: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt
    - S0 prices come from the Azure Retail Prices API (West Europe): https://prices.azure.com/api/retail/prices and https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/
  - The API is async (POST, then poll), which suits a worker.
  - Beside Items, the result also carries the OCR pages, lines and words, so it can feed the same parser as the self-hosted engines.
  - Avoid the newer **Content Understanding** product, which "uses generative AI": https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/overview
- **Google.**
  - Expense Parser fields and languages: https://docs.cloud.google.com/document-ai/docs/fields
  - Processor versions: https://docs.cloud.google.com/document-ai/docs/processors-list
  - Pricing: https://cloud.google.com/document-ai/pricing
  - "We never use customer data to train our Document AI models": https://docs.cloud.google.com/document-ai/docs/security
  - Vision pricing: https://cloud.google.com/vision/pricing
  - Vision data use: https://docs.cloud.google.com/vision/docs/data-usage
  - Vision EU endpoint: https://docs.cloud.google.com/vision/docs/ocr
  - DPA: https://cloud.google.com/terms/data-processing-addendum
- **AWS Textract.**
  - Fields: https://docs.aws.amazon.com/textract/latest/dg/invoices-receipts.html
  - The FAQ says receipts are "English only", and that AWS "may store and use document and image inputs" unless you opt out: https://aws.amazon.com/textract/faqs/
  - Pricing: https://aws.amazon.com/textract/pricing/
  - Opt-out policy: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out.html
- **Mindee.**
  - Receipt fields: https://docs.mindee.com/use-cases/extraction-models/receipt.md
  - Data processing policies: https://docs.mindee.com/models/data-processing-policies
  - Pricing: https://www.mindee.com/pricing
- **Veryfi.**
  - Pricing: https://www.veryfi.com/pricing/
  - Line item fields: https://www.veryfi.com/fields-supported/line-items/
  - Languages: https://www.veryfi.com/ocr-api-platform/ocr-technology-and-languages/
  - The privacy page says it "may use data you submit ... to train": https://www.veryfi.com/privacy
  - Subprocessors: https://www.veryfi.com/subprocessors/
- **Others.**
  - Taggun: https://www.taggun.io/pricing
  - Tabscanner: https://tabscanner.com/pricing/
  - OCR.space: https://ocr.space/ocrapi
  - Nanonets sells "Generative AI blocks", so probably out: https://nanonets.com/pricing
  - Klippa quotes prices on request only.
  - Accuracy: no provider publishes per-language receipt accuracy. The figures on their sites are marketing claims.

## 5. What our parser must do in every option

The parser takes text pieces or words with boxes and confidences, either from a self-hosted engine or from a hosted API's OCR layer. It produces a Draft:

1. **Rows.**
   - Deskew from the boxes.
   - Cluster pieces into printed rows by vertical overlap, allowing for the slope of curled paper.
2. **Columns.**
   - Find the right-aligned price column and any VAT-class letter.
   - Join each name to its price on the same row, or on the next row when the name wraps.
3. **Numbers by locale.**
   - Decimal separators: `1.234,56` vs `1,234.56`.
   - A trailing `-` for negatives.
   - Currency symbols and codes.
   - Exact fractions from the start, never floats (hosted APIs return floats; convert at the boundary).
4. **Line patterns.**
   - `qty x unit price`: `2 x 3,49`, `2 szt. * 3,49`, `2 St x`.
   - Weighed lines, which become one unit at the line price.
   - Line item and Receipt discounts: `Rabat`, `Upust`, `Rabatt`, `Nachlass`, `Popust`, `Sleva`, `Desconto`, `Remise`.
   - Deposits: `Kaucja`, `Pfand`, `Povratna naknada`, `Záloha`, `Consigne`.
   - Deposit refunds, which are negative lines.
   - Voids: `Storno`, `Anulowano`, and others.
5. **Header and footer.**
   - Merchant from the top rows.
   - Date and time by locale.
   - The printed total by keyword: `SUMA`, `RAZEM`, `Summe`, `Gesamt`, `UKUPNO`, `Celkem`, `TOTAL`.
   - Currency.
6. **Reconcile.**
   - Check that the Subtotal, the Receipt discount, the Deposits and the Deposit refunds add up to the printed total.
   - Low confidence or a failed check marks the doubtful lines on the Draft.

Keeping the parser's input engine-neutral (rows of text with boxes and confidences) lets #283 swap engines, or run a hosted one as a fallback, without touching it.

## Shortlist

For the test corpus run in #283, all three behind the same parser:

1. **PaddleOCR PP-OCRv6 small on ONNX Runtime (via RapidOCR), self-hosted.**
   - One Apache-2.0 model covers every Latin-script language we need, Croatian and Polish included.
   - It is the strongest of the open engines in its own benchmarks.
   - It takes under a second per image on a server CPU and has a small container (onnxruntime, no Paddle or PyTorch).
   - It comes with orientation and unwarping models for phone Photos.
   - No data leaves the instance.
2. **OnnxTR (docTR models on ONNX Runtime), self-hosted.**
   - It has the best published receipt numbers among open engines.
   - It returns a proper word/line/block tree with rotated-page handling, and runs on ONNX alone.
   - Watch Croatian `đ`, which needs a fine-tune or a fallback, and the synthetic-only multilingual training on thermal fonts.
3. **Azure Document Intelligence `prebuilt-receipt` in an EU region, hosted reference.**
   - It is the only hosted API that covers all our languages for thermal receipts with per-Line item quantity and unit price, without generative AI.
   - 500 free pages a month, then $10 per 1,000.
   - Data stays in-region, kept at most 24 h and deletable at once, under the Microsoft DPA.
   - It shows how far the self-hosted options are from a commercial reader. If they fall short, it is the paid fallback, at the cost of a processor in the privacy notice.

Tesseract stays a dependency-light baseline worth one run, since it is cheap to add. It trails the others on receipts in every comparison found.

## Open questions

- Measured time and RAM per receipt on the target 4-vCPU class server, for PaddleOCR and OnnxTR. All published timings come from bigger machines.
- Worker language: Python (RapidOCR/OnnxTR, the mature path) or Node (`tesseract.js`, or the small third-party `ppu-paddle-ocr`). This belongs to #283.
- Whether a hosted processor is acceptable at all on the public instance (privacy notice, DPA, an extra subprocessor). A self-hosted engine avoids the question.
- Whether corrected Drafts could later become a labelled set for a fine-tuned model (LiLT). The Photos contain personal data, so that would need consent and its own decision.
- Azure: whether Document Intelligence is in the EU Data Boundary, and the DPA's exact wording on training (_unverified_).
