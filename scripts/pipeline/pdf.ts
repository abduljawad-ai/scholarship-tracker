// PDF -> text. `unpdf` is imported inside the function so HTML-only runs do
// not load the PDF.js bundle.
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf")
  const { text } = await extractText(bytes, { mergePages: true })
  return text
}
