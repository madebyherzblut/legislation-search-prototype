import { globby } from "globby";
import * as path from "node:path";
import * as process from "node:process";
import remarkFrontmatter from "remark-frontmatter";
// import remarkHtml from "remark-html";
import { Client } from "@opensearch-project/opensearch";
import remarkParse from "remark-parse";
import remarkParseFrontmatter from "remark-parse-frontmatter";
import remarkStringify from "remark-stringify";
import strip from "strip-markdown";
import { read } from "to-vfile";
import { unified } from "unified";

const LEGISLATION_DIR = path.join(process.cwd(), "temp", "gesetze");
const LIMIT = 100;
const BATCH_SIZE = 10;

const client = new Client({ node: "http://localhost:9200" });
await client.cluster.health();

// Create search index
await client.indices.delete({ index: "prototype_1", ignore_unavailable: true });
await client.indices.create({ index: "prototype_1" });
await client.indices.putMapping({
  index: "prototype_1",
  body: {
    properties: { text: { type: "text" } },
  },
});

let index = 0;
let batch = [];

const files = await globby(["**/*.md", "!README.md"], { cwd: LEGISLATION_DIR });
for await (const filePath of files) {
  if (index < LIMIT) {
    console.group(path.basename(path.dirname(filePath)));

    const file = await unified()
      .use(remarkParse)
      .use(remarkStringify)
      .use(remarkFrontmatter, ["yaml"])
      .use(remarkParseFrontmatter)
      // .use(remarkHtml)
      .use(strip)
      .process(await read(path.join(LEGISLATION_DIR, filePath)));

    batch.push({ id: file.data.frontmatter.slug, text: file.value });

    index++;
    console.groupEnd();
  }

  if (batch.length === BATCH_SIZE || index >= LIMIT) {
    await client.helpers.bulk({
      datasource: batch,
      onDocument(doc) {
        return {
          index: { _index: "prototype_1" },
        };
      },
    });

    batch = [];
  }

  if (index >= LIMIT) {
    break;
  }
}

console.log("Inserted %s documents", index);
