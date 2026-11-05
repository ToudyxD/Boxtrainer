const ONES = [
  "",
  "ein",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
];

const TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];

/** Zahl als deutsches Wort für Zählungen wie "zwanzig Schläge"; erlaubt 2 bis 99. */
export function germanNumber(n: number): string {
  if (!Number.isInteger(n) || n < 2 || n > 99) throw new RangeError(`Zahl muss eine ganze Zahl von 2 bis 99 sein: ${n}`);
  if (n < 20) return ONES[n] as string;
  const ones = n % 10;
  const tens = TENS[Math.floor(n / 10)] as string;
  return ones === 0 ? tens : `${ONES[ones]}und${tens}`;
}
