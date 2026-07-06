// Print a single isolated section of the page (see the print rules in
// globals.css) by tagging <body> with a data attribute right before invoking
// window.print(), then clearing it once the print dialog closes. This lets
// two independently-triggered printable regions (e.g. the case summary and a
// generated letter) coexist in the DOM without both printing at once.
export function printSection(target: "summary" | "letter") {
  if (typeof document === "undefined") return;

  document.body.dataset.printTarget = target;
  const cleanup = () => {
    delete document.body.dataset.printTarget;
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  window.print();
}
