import { MessageBody, HeaderBlock, ListBlock, CodeBlock, PillPart, FormatPart, NewLinePart, RulePart, TextPart, LinkPart, ImagePart } from "./MessageBody.js"
import { linkify } from "./linkify/linkify.js";
import { parsePillLink } from "./pills.js"

/* At the time of writing (Jul 1 2021), Matrix Spec recommends
 * allowing the following HTML tags:
 *     font, del, h1, h2, h3, h4, h5, h6, blockquote, p, a, ul, ol, sup, sub, li, b, i, u,
 *     strong, em, strike, code, hr, br, div, table, thead, tbody, tr, th, td, caption, pre, span, img
 */

/**
 * Nodes that don't have any properties to them other than their tag.
 * While <a> has `href`, and <img> has `src`, these have... themselves.
 */
const basicInline = ["EM", "STRONG", "CODE", "DEL", "SPAN" ];
const basicBlock = ["DIV", "BLOCKQUOTE"];

class Deserializer {
    constructor(result, mediaRepository) {
        this.result = result;
        this.mediaRepository = mediaRepository;
    }

    parseLink(node, children) {
        // TODO Not equivalent to `node.href`!
        // Add another HTMLParseResult method?
        const href = this.result.getAttributeValue(node, "href");
        const pillData = href && parsePillLink(href);
        if (pillData && pillData.userId) {
            return new PillPart(pillData.userId, href, children);
        }
        return new LinkPart(href, children);
    }

    parseList(node) {
        const result = this.result;
        let start = null;
        if (result.getNodeElementName(node) === "OL") {
            // Will return 1 for, say, '1A', which may not be intended?
            start = parseInt(result.getAttributeValue(node, "start")) || 1;
        }
        const nodes = [];
        for (const child of result.getChildNodes(node)) {
            if (result.getNodeElementName(child) !== "LI") {
                continue;
            }
            const item = this.parseAnyNodes(result.getChildNodes(child));
            nodes.push(item);
        }
        return new ListBlock(start, nodes);
    }

    parseCodeBlock(node) {
        const result = this.result;
        let codeNode;
        for (const child of result.getChildNodes(node)) {
            codeNode = child;
            break;
        }
        if (!(codeNode && result.getNodeElementName(codeNode) === "CODE")) {
            return null;
        }
        let language = "";
        const cl = result.getAttributeValue(codeNode, "class") || ""
        for (const clname of cl.split(" ")) {
            if (clname.startsWith("language-") && !clname.startsWith("language-_")) {
                language = clname.substring(9) // "language-".length
                break;
            }
        }
        return new CodeBlock(language, codeNode.textContent);
    }

    parseImage(node) {
        const result = this.result;
        const src = result.getAttributeValue(node, "src") || "";
        const url = this.mediaRepository.mxcUrl(src);
        // We just ignore non-mxc `src` attributes.
        if (!url) {
            return null;
        }
        const width = parseInt(result.getAttributeValue(node, "width")) || null;
        const height = parseInt(result.getAttributeValue(node, "height")) || null;
        const alt = result.getAttributeValue(node, "alt");
        const title = result.getAttributeValue(node, "title");
        return new ImagePart(url, width, height, alt, title);
    }

    /** Once a node is known to be an element,
     * attempt to interpret it as an inline element.
     *
     * @returns the inline message part, or null if the element
     *   is not inline or not allowed.
     */
    parseInlineElement(node) {
        const result = this.result;
        const tag = result.getNodeElementName(node);
        const children = result.getChildNodes(node);
        switch (tag) {
            case "A": {
                const inlines = this.parseInlineNodes(children);
                return this.parseLink(node, inlines);
            }
            case "BR":
                return new NewLinePart();
            default: {
                if (!basicInline.includes(tag)) {
                    return null;
                }
                const inlines = this.parseInlineNodes(children);
                return new FormatPart(tag, inlines);
            }
        }
    }

    /** Attempt to interpret a node as inline.
     *
     * @returns the inline message part, or null if the
     *   element is not inline or not allowed.
     */
    parseInlineNode(node) {
        if (this.result.isElementNode(node)) {
            return this.parseInlineElement(node);
        }
        return null;
    }

    /** Once a node is known to be an element, attempt
     * to interpret it as a block element.
     *
     * @returns the block message part, or null of the
     *   element is not a block or not allowed.
     */
    parseBlockElement(node) {
        const result = this.result;
        const tag = result.getNodeElementName(node);
        const children = result.getChildNodes(node);
        switch (tag) {
            case "H1":
            case "H2":
            case "H3":
            case "H4":
            case "H5":
            case "H6": {
                const inlines = this.parseInlineNodes(children);
                return new HeaderBlock(parseInt(tag[1]), inlines)
            }
            case "UL":
            case "OL":
                return this.parseList(node);
            case "PRE":
                return this.parseCodeBlock(node);
            case "HR":
                return new RulePart();
            case "IMG":
                return this.parseImage(node);
            case "P": {
                const inlines = this.parseInlineNodes(children);
                return new FormatPart(tag, inlines);
            }
            default: {
                if (!basicBlock.includes(tag)) {
                    return null;
                }
                const blocks = this.parseAnyNodes(children);
                return new FormatPart(tag, blocks);
            }
        }
    }

    /** Attempt to parse a node as a block.
     *
     * @return the block message part, or null if the node
     *   is not a block element.
     */
    parseBlockNode(node) {
        if (this.result.isElementNode(node)) {
            return this.parseBlockElement(node);
        }
        return null;
    }

    _parseTextParts(node, into) {
        if(!this.result.isTextNode(node)) {
            return false;
        }

        // XXX pretty much identical to `MessageBody`'s.
        const linkifyCallback = (text, isLink) => {
            if (isLink) {
                into.push(new LinkPart(text, [new TextPart(text)]));
            } else {
                into.push(new TextPart(text));
            }
        };
        linkify(this.result.getNodeText(node), linkifyCallback);
        return true;
    }

    _parseInlineNodes(nodes, into) {
        for (const htmlNode of nodes) {
            if (this._parseTextParts(htmlNode, into)) {
                // This was a text node, and we already
                // dumped its parts into our list.
                continue;
            }
            const node = this.parseInlineNode(htmlNode);
            if (node) {
                into.push(node);
                continue;
            }
            // Node is either block or unrecognized. In
            // both cases, just move on to its children.
            this._parseInlineNodes(this.result.getChildNodes(htmlNode), into);
        }
    }

    parseInlineNodes(nodes) {
        const into = [];
        this._parseInlineNodes(nodes, into);
        return into;
    }

    // XXX very similar to `_parseInlineNodes`.
    _parseAnyNodes(nodes, into) {
        for (const htmlNode of nodes) {
            if (this._parseTextParts(htmlNode, into)) {
                // This was a text node, and we already
                // dumped its parts into our list.
                continue;
            }
            const node = this.parseInlineNode(htmlNode) || this.parseBlockNode(htmlNode);
            if (node) {
                into.push(node);
                continue;
            }
            // Node is unrecognized. Just move on to its children.
            this._parseAnyNodes(this.result.getChildNodes(htmlNode), into);
        }
    }

    parseAnyNodes(nodes) {
        const into = [];
        this._parseAnyNodes(nodes, into);
        return into;
    }
}

export function parseHTMLBody(platform, mediaRepository, html) {
    const parseResult = platform.parseHTML(html);
    const deserializer = new Deserializer(parseResult, mediaRepository);
    const parts = deserializer.parseAnyNodes(parseResult.rootNodes);
    return new MessageBody(html, parts);
}

import parse from '../../../../../lib/node-html-parser/index.js';

export function tests() {
    class HTMLParseResult {
        constructor(bodyNode) {
            this._bodyNode = bodyNode;
        }

        get rootNodes() {
            return this._bodyNode.childNodes;
        }

        getChildNodes(node) {
            return node.childNodes;
        }

        getAttributeNames(node) {
            return node.getAttributeNames();
        }

        getAttributeValue(node, attr) {
            return node.getAttribute(attr);
        }

        isTextNode(node) {
            return !node.tagName;
        }

        getNodeText(node) {
            return node.text;
        }

        isElementNode(node) {
            return !!node.tagName;
        }

        getNodeElementName(node) {
            return node.tagName;
        }
    }

    const platform = {
        parseHTML: (html) => new HTMLParseResult(parse(html))
    };

    function test(assert, input, output) {
        assert.deepEqual(parseHTMLBody(platform, null, input), new MessageBody(input, output));
    }

    return {
        "Text only": assert => {
            const input = "This is a sentence";
            const output = [new TextPart(input)];
            test(assert, input, output);
        },
        "Text with inline code format": assert => {
            const input = "Here's <em>some</em> <code>code</code>!";
            const output = [
                new TextPart("Here's "),
                new FormatPart("em", [new TextPart("some")]),
                new TextPart(" "),
                new FormatPart("code", [new TextPart("code")]),
                new TextPart("!")
            ];
            test(assert, input, output);
        },
        "Text with ordered list with no attributes": assert => {
            const input = "<ol><li>Lorem</li><li>Ipsum</li></ol>";
            const output = [
                new ListBlock(1, [
                    [ new TextPart("Lorem") ],
                    [ new TextPart("Ipsum") ]
                ])
            ];
            test(assert, input, output);
        },
        "Text with ordered list starting at 3": assert => {
            const input = '<ol start="3"><li>Lorem</li><li>Ipsum</li></ol>';
            const output = [
                new ListBlock(3, [
                    [ new TextPart("Lorem") ],
                    [ new TextPart("Ipsum") ]
                ])
            ];
            test(assert, input, output);
        },
        "Text with unordered list": assert => {
            const input = '<ul start="3"><li>Lorem</li><li>Ipsum</li></ul>';
            const output = [
                new ListBlock(null, [
                    [ new TextPart("Lorem") ],
                    [ new TextPart("Ipsum") ]
                ])
            ];
            test(assert, input, output);
        },
        "Auto-closed tags": assert => {
            const input = '<p>hello<p>world</p></p>';
            const output = [
                new FormatPart("p", [new TextPart("hello")]),
                new FormatPart("p", [new TextPart("world")])
            ];
            test(assert, input, output);
        },
        "Block elements ignored inside inline elements": assert => {
            const input = '<span><p><code>Hello</code></p></span>';
            const output = [
                new FormatPart("span", [new FormatPart("code", [new TextPart("Hello")])])
            ];
            test(assert, input, output);
        },
        "Unknown tags are ignored, but their children are kept": assert => {
            const input = '<span><dfn><code>Hello</code></dfn><footer><em>World</em></footer></span>';
            const output = [
                new FormatPart("span", [
                    new FormatPart("code", [new TextPart("Hello")]),
                    new FormatPart("em", [new TextPart("World")])
                ])
            ];
            test(assert, input, output);
        },
        "Unknown and invalid attributes are stripped": assert => {
            const input = '<em onmouseover=alert("Bad code!")>Hello</em>';
            const output = [
                new FormatPart("em", [new TextPart("Hello")])
            ];
            test(assert, input, output);
        },
        /* Doesnt work: HTML library doesn't handle <pre><code> properly.
        "Text with code block": assert => {
            const code = 'main :: IO ()\nmain = putStrLn "Hello"'
            const input = `<pre><code>${code}</code></pre>`;
            const output = [
                new CodeBlock(null, code)
            ];
            test(assert, input, output);
        }
        */
    };
}