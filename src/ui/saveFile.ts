/** Gibt dem Nutzer eine Datei: über das Share-Sheet (iOS), sonst als Download. */
export async function saveTextFile(name: string, text: string): Promise<void> {
  const file = new File([text], name, { type: "application/json" });

  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
