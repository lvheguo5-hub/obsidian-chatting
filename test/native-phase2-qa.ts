// Desktop-only integration fixture. Calls the real tool executor with native
// Obsidian APIs; never replaces the production agent or provider adapters.
import { Plugin } from "obsidian";
import { executeTool } from "../src/tools/executor";

const ROOT = "QA/Phase2-20261015";
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

export default class Phase2NativeQA extends Plugin {
  async runQA(): Promise<Record<string, unknown>> {
    assert(this.app.vault.getName() === "ob 插件测试", "Wrong vault");
    const checks: string[] = [];
    const run = async (name: string, input: Record<string, unknown>, error = false) => {
      await this.app.vault.adapter.write(`${this.manifest.dir}/progress.json`, JSON.stringify({ step: name, time: new Date().toISOString() }));
      const result = await executeTool(this.app, name, input, async () => "QA fixture");
      assert(result.isError === error, `${name}: ${result.result}`);
      await this.app.vault.adapter.write(`${this.manifest.dir}/progress.json`, JSON.stringify({ completed: name, time: new Date().toISOString() }));
      checks.push(`${name}:${error ? "expected-error" : "ok"}`);
      return result;
    };
    if (!this.app.vault.getFolderByPath("QA")) await this.app.vault.createFolder("QA");
    if (!this.app.vault.getFolderByPath(ROOT)) await this.app.vault.createFolder(ROOT);
    const fixtures = {
      [`${ROOT}/Phase2-A.md`]: "---\ntags: [phase2-qa]\nstatus: open\n---\n# Phase2-A\nSynthetic phase 2 native fixture.\n",
      [`${ROOT}/Phase2-B.md`]: `# Phase2-B\n[[${ROOT}/Phase2-A|Phase2-A]]\nPhase2-A unlinked mention.\n`,
      [`${ROOT}/Board.canvas`]: JSON.stringify({ nodes: [], edges: [], qa_fixture: "phase2-native" }),
    };
    for (const [path, content] of Object.entries(fixtures)) {
      const existing = this.app.vault.getFileByPath(path);
      if (existing) assert((await this.app.vault.cachedRead(existing)).toLowerCase().includes("phase2"), `Not a QA fixture: ${path}`);
      if (existing) await this.app.vault.modify(existing, content);
      else await run("create_file", { path, content });
    }
    const a = this.app.vault.getFileByPath(`${ROOT}/Phase2-A.md`)!;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (this.app.metadataCache.getFileCache(a)?.frontmatter?.status === "open") break;
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    assert((await run("query_notes", { tags: ["phase2-qa"], folder: ROOT })).result.includes("Phase2-A.md"), "Metadata query");
    assert((await run("list_metadata", { folder: ROOT })).result.includes("phase2-qa"), "Metadata inventory");
    assert((await run("get_links", { path: a.path })).result.includes("Phase2-B.md"), "Native links");
    const canvasPath = `${ROOT}/Board.canvas`;
    await run("edit_canvas", { path: canvasPath, operations: [
      { op: "add_node", type: "text", text: "Phase 2 native Canvas", ref: "card" },
      { op: "add_node", type: "file", file: a.path, near: "card", ref: "note" },
      { op: "add_edge", fromNode: "card", toNode: "note", label: "QA link" },
    ] });
    const file = this.app.vault.getFileByPath(canvasPath)!;
    const before = await this.app.vault.read(file);
    await run("edit_canvas", { path: canvasPath, operations: [
      { op: "add_node", type: "text", text: "Must not persist" },
      { op: "remove_node", id: "missing-node" },
    ] }, true);
    assert(await this.app.vault.read(file) === before, "Canvas batch must be atomic");
    const scoped = await executeTool(this.app, "edit_canvas", { path: canvasPath, operations: [{ op: "remove_node", id: "missing-node" }] }, async () => "", { filePath: canvasPath, text: "selected card" });
    assert(scoped.isError && scoped.result.includes("selection"), "Canvas selection boundary");
    checks.push("canvas-selection:ok");
    assert((await run("read_canvas", { path: canvasPath })).result.includes("QA link"), "Canvas outline");
    assert((await run("search_vault", { query: "Phase 2 native Canvas", searchContent: true })).result.includes("Board.canvas"), "Canvas search");
    const surface = document.createElement("canvas");
    surface.width = 160; surface.height = 100;
    const context = surface.getContext("2d")!;
    context.fillStyle = "#8b5cf6"; context.fillRect(0, 0, 160, 100);
    context.fillStyle = "white"; context.font = "bold 24px sans-serif"; context.fillText("PHASE 2", 20, 58);
    const png = await new Promise<Blob>(resolve => surface.toBlob(blob => resolve(blob!), "image/png"));
    const imagePath = `${ROOT}/Fixture.png`;
    const existingImage = this.app.vault.getFileByPath(imagePath);
    if (existingImage) await this.app.vault.modifyBinary(existingImage, await png.arrayBuffer());
    else await this.app.vault.createBinary(imagePath, await png.arrayBuffer());
    const viewed = await run("view_image", { path: imagePath });
    assert(viewed.images?.[0]?.data && viewed.images[0].mediaType === "image/png", "Real image decoding");
    const largePath = `${ROOT}/HugeFixture.png`;
    const hasLargeFixture = !!this.app.vault.getFileByPath(largePath);
    if (hasLargeFixture) await run("edit_canvas", { path: canvasPath, operations: [
      { op: "add_node", type: "file", file: largePath },
    ] });
    const drawing = await run("view_canvas", { path: canvasPath });
    if (hasLargeFixture) {
      assert(drawing.result.includes("Image preview omitted") && drawing.result.includes("HugeFixture.png"), "Large image rejected before decode");
      checks.push("large-image-preview:ok");
      const resized = await run("view_image", { path: largePath });
      assert(resized.result.includes("2048×1536"), "Large image decoded at bounded output size");
      checks.push("large-image-resize:ok");
    }
    assert(drawing.images?.[0]?.data && drawing.images[0].sizeBytes > 0, "Real Canvas encoding");
    // Evidence image stays in this synthetic fixture folder.
    const picture = drawing.images![0];
    const bytes = Uint8Array.from(atob(picture.data), char => char.charCodeAt(0)).buffer;
    const renderPath = `${ROOT}/Rendered.${picture.mediaType === "image/png" ? "png" : "jpg"}`;
    const existingRender = this.app.vault.getFileByPath(renderPath);
    if (existingRender) await this.app.vault.modifyBinary(existingRender, bytes);
    else await this.app.vault.createBinary(renderPath, bytes);
    assert((await run("read_web_page", { url: "https://example.com/" })).result.includes("Example Domain"), "Native web request/DOM conversion");
    const report = { scope: "native Obsidian APIs and production tool source; no agent or provider mocks", checks, canvasAtomic: true,
      imageBytes: viewed.images![0].sizeBytes, renderedBytes: picture.sizeBytes, renderedPath: renderPath, createdOnlyUnder: ROOT };
    await this.app.vault.adapter.write(`${this.manifest.dir}/report.json`, JSON.stringify(report, null, 2));
    return report;
  }
}
