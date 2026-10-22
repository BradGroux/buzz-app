// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import { downloadNativeMedia } from "./native-download";
import { FileAttachment, formatFileSize } from "./FileAttachment";

vi.mock("./native-download", () => ({ downloadNativeMedia: vi.fn() }));

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const proxySource = "/api/relay/media?url=https%3A%2F%2Ffixture.test%2Ffile";

afterEach(() => {
  cleanup();
  vi.mocked(downloadNativeMedia).mockReset();
});

it.each([
  [1, "1 B"],
  [1023, "1023 B"],
  [1024, "1 KB"],
  [1536, "2 KB"],
  [1024 * 1024, "1 MB"],
  [1024 * 1024 * 1024, "1 GB"],
])("formats file sizes at unit boundaries", (size, label) => {
  expect(formatFileSize(size)).toBe(label);
});

it("falls back to a mime-derived file label", () => {
  render(
    <FileAttachment
      attachment={{
        url: "https://fixture.test/file",
        kind: "file",
        mime: "application/pdf",
      }}
      source={proxySource}
      onOpenLink={() => false}
    />,
  );
  expect(
    screen.getByRole("link", { name: "Download PDF file" }),
  ).toHaveAttribute("href", proxySource);
  expect(screen.getByText("PDF file")).toBeInTheDocument();
  expect(screen.getByText("Download file")).toBeInTheDocument();
});

it("falls back to a generic file label", () => {
  render(
    <FileAttachment
      attachment={{ url: "https://fixture.test/file", kind: "file" }}
      source={proxySource}
      onOpenLink={() => false}
    />,
  );
  expect(
    screen.getByRole("link", { name: "Download File" }),
  ).toBeInTheDocument();
});

it("keeps nameless downloads on the media href", () => {
  render(
    <FileAttachment
      attachment={{ url: "https://fixture.test/file", kind: "file" }}
      source={proxySource}
      onOpenLink={() => false}
    />,
  );
  expect(screen.getByRole("link", { name: "Download File" })).toHaveAttribute(
    "href",
    proxySource,
  );
  expect(screen.getByRole("link", { name: "Download File" })).toHaveAttribute(
    "download",
    "",
  );
});

it("renders long names as the title while keeping full download semantics", () => {
  const name = `${"Very long report name ".repeat(12)}.pdf`;
  render(
    <FileAttachment
      attachment={{
        url: "https://fixture.test/file",
        kind: "file",
        name,
        size: 1536,
      }}
      source={proxySource}
      onOpenLink={() => false}
    />,
  );
  const link = screen.getByRole("link", { name: `Download ${name}` });
  expect(link).toHaveAttribute("download", name);
  expect(link).toHaveAttribute("title", name);
  expect(screen.getByText("2 KB")).toBeInTheDocument();
});

it("opens external https sources through the opener pattern without download affordance", () => {
  const source = "https://files.example/report.pdf";
  const open = vi.fn(() => true);
  render(
    <FileAttachment
      attachment={{
        url: source,
        kind: "file",
        name: "report.pdf",
      }}
      source={source}
      onOpenLink={open}
    />,
  );
  const link = screen.getByRole("link", { name: "Open report.pdf" });
  expect(link).toHaveAttribute("href", source);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noreferrer");
  expect(link).not.toHaveAttribute("download");
  expect(screen.getByText("Open file")).toBeInTheDocument();
  expect(fireEvent.click(link)).toBe(false);
  expect(open).toHaveBeenCalledWith(source);
});

it("renders unopenable file sources as unavailable", () => {
  render(
    <FileAttachment
      attachment={{
        url: "https://fixture.test/file",
        kind: "file",
        name: "file.pdf",
      }}
      source="blob:https://fixture.test/file"
      onOpenLink={() => false}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("File unavailable");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it.each(["application/octet-stream"])(
  "does not derive noisy labels from %s",
  (mime) => {
    render(
      <FileAttachment
        attachment={{ url: "https://fixture.test/file", kind: "file", mime }}
        source={proxySource}
        onOpenLink={() => false}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Download File" }),
    ).toBeInTheDocument();
    expect(screen.getByText("File")).toBeInTheDocument();
  },
);

const nativeSource = `buzz-media://localhost/${encodeURIComponent(`https://relay.test/media/${"a".repeat(64)}.pdf`)}`;

it("shows pending and completed native downloads without duplicate requests", async () => {
  const request = deferred();
  vi.mocked(downloadNativeMedia).mockReturnValueOnce(request.promise);
  const open = vi.fn(() => false);
  const view = render(
    <FileAttachment
      attachment={{
        url: "https://relay.test/media/file",
        kind: "file",
        name: "report.pdf",
      }}
      source={nativeSource}
      onOpenLink={open}
    />,
    { wrapper: ToastProvider },
  );
  const button = screen.getByRole("button", { name: "Download report.pdf" });
  expect(button).not.toHaveAttribute("href");
  expect(screen.getByText("Download file")).toBeInTheDocument();
  fireEvent.click(button);
  try {
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Downloading…")).toBeInTheDocument();
    fireEvent.click(button);
    expect(downloadNativeMedia).toHaveBeenCalledTimes(1);
    expect(downloadNativeMedia).toHaveBeenCalledWith(
      nativeSource,
      "report.pdf",
    );
    expect(open).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "File saved to Downloads" }),
    ).toBeNull();
  } finally {
    await act(() => request.resolve());
  }
  const notice = await screen.findByRole("dialog", {
    name: "File saved to Downloads",
  });
  expect(button).toBeEnabled();
  expect(button).not.toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("Downloading…")).toBeNull();
  view.rerender(null);
  expect(notice).toBeInTheDocument();
});

it.each([
  `buzz-media://evil.test/${encodeURIComponent(`https://relay.test/media/${"a".repeat(64)}`)}`,
  `buzz-media://localhost/${encodeURIComponent("https://relay.test/query")}`,
])("does not offer a download for native lookalike %s", (source) => {
  render(
    <FileAttachment
      attachment={{ url: "https://relay.test/file", kind: "file" }}
      source={source}
      onOpenLink={() => false}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("File unavailable");
  expect(screen.queryByRole("link")).toBeNull();
});

it("keeps native download failures visible and allows retry", async () => {
  const request = deferred();
  const retry = deferred();
  vi.mocked(downloadNativeMedia)
    .mockReturnValueOnce(request.promise)
    .mockReturnValueOnce(retry.promise);
  render(
    <FileAttachment
      attachment={{
        url: "https://relay.test/file",
        kind: "file",
        name: "report.pdf",
      }}
      source={nativeSource}
      onOpenLink={() => false}
    />,
    { wrapper: ToastProvider },
  );
  const button = screen.getByRole("button", { name: "Download report.pdf" });
  fireEvent.click(button);
  await act(() => request.reject(new Error("unavailable")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Download failed");
  expect(button).toBeEnabled();
  expect(
    screen.queryByRole("dialog", { name: "File saved to Downloads" }),
  ).toBeNull();
  fireEvent.click(button);
  try {
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button).toBeDisabled();
    expect(downloadNativeMedia).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => retry.resolve());
  }
  expect(
    await screen.findByRole("dialog", { name: "File saved to Downloads" }),
  ).toBeInTheDocument();
  expect(button).toBeEnabled();
});
