import type { Root, RootContent, Element } from "hast";

// Add highlights in the Markdown render tree, without mutating React's DOM.
export function searchHighlight({ query }: { query: string }) {
  const text = query.trim();
  return (tree: Root) => {
    if (!text) return;
    const pattern = new RegExp(
      text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "giu",
    );
    function visit(parent: Root | Element) {
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if (node.type === "element") {
          visit(node);
          return [node];
        }
        if (node.type !== "text") return [node];
        const result: RootContent[] = [];
        let end = 0;
        for (const match of node.value.matchAll(pattern)) {
          const index = match.index!;
          if (index > end)
            result.push({ type: "text", value: node.value.slice(end, index) });
          result.push({
            type: "element",
            tagName: "mark",
            properties: { "data-search-match": true },
            children: [{ type: "text", value: match[0] }],
          });
          end = index + match[0].length;
        }
        if (!end) return [node];
        if (end < node.value.length)
          result.push({ type: "text", value: node.value.slice(end) });
        return result;
      }) as typeof parent.children;
    }
    visit(tree);
  };
}
