# CrossDoc 主页

产品主页。

- **排版**参考 [verge-ai.xyz](https://verge-ai.xyz/)：导航 → hero（eyebrow + 大标题 + 说明 + 双 CTA + 胶囊）→ 窗口 mock →
  每个 section 都是「eyebrow + 大标题 + 右侧箭头链接」→ 特性卡 + 三卡 → 步骤条 → 预览 → 页脚。
- **风格**完全沿用 app 现有的纸感体系：米色纸底 + 30px 网格、墨色、发丝线、2px 规则线、
  mono 分类标签、衬线引文与标题、印刷红线（左侧删除线红 / 右侧下划线蓝）。**只有一种模式，不分昼夜。**
- **不放付费内容**：没有定价、没有档位、没有订阅。参考站里对应「月卡订阅」的位置换成了
  「工作原理」的六步流程。

```
site/
  index.html          页面结构
  styles.css          样式与设计 token
  preview.png         桌面宽度全页预览
  assets/
    crossdoc-logo.svg 与 app 同一版 logo（墨色，纸底上直接能用）
```

![CrossDoc 主页预览](./preview.png)

## 本地预览

```bash
cd site && python3 -m http.server 5180
# → http://localhost:5180/
```

纯静态，没有构建步骤，也没有依赖。`site/` 目录本身就是一个可发布的静态站点。

## 改应用地址

「开始核对」「打开工作台」指向本地跑起来的 app，默认 `http://localhost:5177/`。
改地址的地方：

- `site/index.html` 顶部有注释标记，所有指向 app 的链接

部署到公网时，把它们换成实际部署后的应用地址；如果应用只能本地运行，就把主 CTA 改成
「克隆运行 → GitHub」，把「打开工作台」降级成页脚里的说明。

## 与 app 的关系

主页是静态的，不依赖 app 运行。app 本体仍然是 `public/`，由 `src/server.ts` 提供服务，
工作台在 http://localhost:5177/ 。两边共用同一套 token 和同一版 logo。

## 发布

`site/` 里有 `index.html`，可以直接作为静态站点发布。发布前记得：

1. 把指向 app 的链接换成可访问的地址
2. 确认 `assets/crossdoc-logo.svg` 随站点一起上传
3. 仓库是 PUBLIC，发布到公网后任何拿到链接的人都能看到
