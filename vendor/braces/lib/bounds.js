'use strict';
const MAX_DEPTH = 64;
const MAX_NODES = 50000;
// Conservative preflight: over-limit literal/quoted delimiters are rejected too.
exports.assertPattern = input => {
  let depth = 0;
  for (const char of input) {
    if (char === '{' || char === '(' || char === '[') {
      if (++depth > MAX_DEPTH) throw new RangeError('Brace nesting exceeds the safety limit');
    } else if (char === '}' || char === ')' || char === ']') depth = Math.max(0, depth - 1);
  }
};
// ASTs can also enter compile/expand/stringify directly; never recurse to validate.
exports.assertAst = ast => {
  const stack = [[ast, 0]];
  const seen = new Set();
  let count = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) throw new RangeError('Invalid or cyclic brace AST');
    seen.add(node);
    let parentHops = 0;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (++parentHops > MAX_DEPTH) throw new RangeError('Invalid or cyclic brace AST parent chain');
    }
    if (depth > MAX_DEPTH || ++count > MAX_NODES) throw new RangeError('Brace AST exceeds the safety limit');
    if (node.nodes) {
      if (!Array.isArray(node.nodes) || node.nodes.length > MAX_NODES) throw new RangeError('Invalid brace AST nodes');
      for (const child of node.nodes) stack.push([child, depth + 1]);
    }
  }
};
