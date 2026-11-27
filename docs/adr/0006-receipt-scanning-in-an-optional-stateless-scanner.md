---
status: deprecated
---

# Receipt scanning reads in an optional, stateless scanner; the app queues Drafts in PostgreSQL

_Shelved on 2026-11-27 with Receipt scanning, before any of it was built: the rule-based parser it relies on didn't meet expectations. Kept as the record of the engine and queue choices for when scanning is picked up again._

Scanning a Receipt is split in two. The app owns the queue: it claims waiting Drafts in its own PostgreSQL (`FOR UPDATE SKIP LOCKED`, a lease with an attempt count), reads the Photo from its volume, and posts the picture to the scanner. The scanner is a separate, optional container that only reads text: picture in, text lines with their boxes and confidences out. It has no database, no Photo volume, no Trip rules and no internet access. Everything that knows the domain stays in the app: the Receipt parser, writing the Draft, bumping the Trip version for the whole-Trip pull, and the Notification. An instance that runs no scanner has scanning switched off.

The scanner runs RapidOCR (PaddleOCR PP-OCRv6 small on ONNX Runtime) in Python, on CPU. On the receipt test corpus it found the most amounts, totals and dates among the self-hosted engines tried, at about 2-3 s and under 1.2 GB per Receipt on 4 vCPUs. It is the one Python component in a TypeScript repo, kept to a single read endpoint.

## Considered options

- **A message broker** (Redis, RabbitMQ): another stateful service to run and back up, for a queue of a few Drafts at a time.
- **A worker with its own database access** that claims Drafts itself: it would need database credentials, the Photo volume, the Trip version rule and the VAPID keys, which means a second copy of server rules in a second language.
- **A hosted receipt API** (Azure Document Intelligence and others): it sends Participants' receipts to a third party, a GDPR processor, and none returns our Receipt anyway (no Deposits, Deposit refunds or voids), so our parser is needed either way. Kept out of every instance.
- **OnnxTR**, which keeps Polish diacritics, was 3-4× slower, needed 3-4× the memory and failed on rotated photos. **PP-OCR in Node** (`ppu-paddle-ocr`) read worse on small and Portuguese receipts and needed twice the memory.
- **LLM and vision-language models**: ruled out for this effort.

## Consequences

- The scanner can be replaced by any engine that answers the same read endpoint. The parser stays engine-neutral.
- A read that can't reach the scanner doesn't count as an attempt: Drafts stay "reading" while the scanner is down or switched off.
- One read at a time per instance. Scanning is never immediate: devices see a read Draft through their normal sync, and the scanning device also gets a Notification.
- RapidOCR drops many Polish diacritics (ł read as t). Participants fix names while checking a Draft.
- The repo gains a second toolchain (Python with locked dependencies) and a third image to build, license and publish.
