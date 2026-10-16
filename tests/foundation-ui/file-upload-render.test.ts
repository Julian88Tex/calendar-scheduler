// FileUpload preview (SPEC BR-01): a profile picture without an image shows the person's initials (like the avatar
// elsewhere), other uploads show the upload icon, and a current image replaces both.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileUpload } from "@/components/ui/file-upload";

const render = (props: Partial<Parameters<typeof FileUpload>[0]>) =>
  renderToStaticMarkup(createElement(FileUpload, { onFile: () => {}, label: "Upload picture", previewShape: "circle", ...props }));

describe("FileUpload preview placeholder", () => {
  it("shows the initials of `name` while there is no picture", () => {
    const html = render({ value: null, name: "Julian Joseph" });
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>JJ<\/span>/);
    expect(html).not.toContain("<img");
  });

  it("falls back to the upload icon without a name, and shows the image when there is one", () => {
    expect(render({ value: null, name: "  " })).not.toMatch(/>JJ</);
    expect(render({ value: null })).toContain("<svg");
    const withImage = render({ value: "/api/files/abc", name: "Julian Joseph" });
    expect(withImage).toContain('src="/api/files/abc"');
    expect(withImage).not.toMatch(/>JJ</);
  });
});
