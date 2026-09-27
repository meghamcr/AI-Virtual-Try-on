import { it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { fetchImage, resolvePublic } from "../apps/api/src/images";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
it("rejects hostnames when any resolved address is private", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ] as any);
  await expect(resolvePublic("https://shop.example/image.jpg")).rejects.toThrow(
    "UNSAFE_IMAGE_URL",
  );
});
it("pins validated DNS in both Node callback forms", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ] as any);
  vi.spyOn(https, "get").mockImplementation(((
    _url: any,
    options: any,
    callback: any,
  ) => {
    options.lookup(
      "shop.example",
      { all: true },
      (error: any, addresses: any) => {
        expect(error).toBeNull();
        expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      },
    );
    options.lookup(
      "shop.example",
      {},
      (_e: any, address: string, family: number) => {
        expect(address).toBe("93.184.216.34");
        expect(family).toBe(4);
      },
    );
    const req = new EventEmitter() as any;
    req.destroy = (e: Error) => req.emit("error", e);
    queueMicrotask(() => {
      const response = new EventEmitter() as any;
      response.statusCode = 200;
      response.headers = {};
      callback(response);
      response.emit("data", Buffer.from("image-bytes"));
      response.emit("end");
    });
    return req;
  }) as any);
  expect((await fetchImage("https://shop.example/image.jpg")).toString()).toBe(
    "image-bytes",
  );
});
it("revalidates redirects and blocks cloud metadata destinations", async () => {
  vi.mocked(lookup).mockImplementation(
    async (host: any) =>
      [
        {
          address:
            host === "shop.example" ? "93.184.216.34" : "169.254.169.254",
          family: 4,
        },
      ] as any,
  );
  const spy = vi.spyOn(https, "get").mockImplementation(((
    _url: any,
    _options: any,
    callback: any,
  ) => {
    const req = new EventEmitter() as any;
    queueMicrotask(() => {
      const response = new EventEmitter() as any;
      response.statusCode = 302;
      response.headers = {
        location: "http://169.254.169.254/latest/meta-data",
      };
      response.resume = () => {};
      callback(response);
    });
    return req;
  }) as any);
  await expect(fetchImage("https://shop.example/image.jpg")).rejects.toThrow(
    "UNSAFE_IMAGE_URL",
  );
  expect(spy).toHaveBeenCalledTimes(1);
});
