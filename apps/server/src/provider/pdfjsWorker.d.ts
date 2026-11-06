// pdfjs-dist ships no types for its worker entry; the document-text worker preloads it in-process.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
