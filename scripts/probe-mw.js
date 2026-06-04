fetch("https://makerworld.com.cn/zh", {
  headers: { "User-Agent": "Mozilla/5.0" }
})
  .then((r) => r.text())
  .then((t) => {
    const fonts = [...t.matchAll(/font-family:\s*([^;"'}]+)/gi)].map((m) => m[1].trim()).slice(0, 20);
    const links = [...t.matchAll(/href="([^"]+\.css[^"]*)"/gi)].map((m) => m[1]).slice(0, 10);
    console.log("fonts", [...new Set(fonts)]);
    console.log("css", links);
  })
  .catch((e) => console.error(e));
