// Minimal no-framework DOM helper. `el()` is a tiny hyperscript-style builder;
// screens compose markup with it instead of template strings so nothing needs
// escaping and event handlers stay real function references.

type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string; // textContent
  onClick?: (e: MouseEvent) => void;
  attrs?: Record<string, string>; // setAttribute for each
}

function appendChildren(node: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props?.class) node.className = props.class;
  if (props?.text !== undefined) node.textContent = props.text;
  if (props?.onClick) {
    const onClick = props.onClick;
    node.addEventListener("click", (e) => onClick(e as MouseEvent));
  }
  if (props?.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) {
      node.setAttribute(name, value);
    }
  }
  appendChildren(node, children);
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function mount(root: HTMLElement, ...children: Child[]): void {
  clear(root);
  appendChildren(root, children);
}
