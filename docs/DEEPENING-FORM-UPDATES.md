# 外包深化表单 · 实施说明

> 实施日期：2026-05-31  
> 状态：**已实施**  
> 当前形态：**API 能力**；前端详情页暂无导入预览卡片

外包深化表单 API 将基本信息、详细报价清单、标签与交付发布字段导出为 JSON/ZIP，供外包离线深化；支持导入预览与应用。五类交付附件仍在系统内上传，不随表单 ZIP 打包。当前版本不宣称详情页提供导入预览卡片，调用方可直接使用下列 API。

---

## 1. 入口与权限

| 项 | 说明 |
|----|------|
| 位置 | `GET/POST /api/templates/:id/deepening-form*` 接口 |
| 导出 | 编辑权限（`canWrite`） |
| 导入 preview / apply | 编辑权限；apply 须模板 **可编辑**（非已发布只读） |
| 已发布 | 可 **仅导出空表**（勾选「导出空表」）；导入 apply 被服务端拦截 |

---

## 2. 导出

| 格式 | API | 文件名 |
|------|-----|--------|
| JSON | `GET /api/templates/:id/deepening-form.json` | `{编号}_深化表单.json` |
| ZIP | `GET /api/templates/:id/deepening-form.zip` | `{编号}_深化表单.zip` |
| 空表 | 上述 URL 加 `?empty=1` | 同上（字段为空模板） |

ZIP 内容：

- `00-填写说明.txt` — 离线填写说明
- `01-基本信息.csv` 至 `06-其他.csv` — 分区填写表
- `catalog-六通.csv`、`catalog-五金.csv`、`catalog-板材.csv` — 分类单价库快照
- `form.json` — 完整主数据（`format: mr2525-template-form-v1`），导入时优先使用

---

## 3. 导入

| 步骤 | API | 说明 |
|------|-----|------|
| 预览 | `POST /api/templates/:id/deepening-form/preview` | multipart `file`；返回 diff、warnings、errors |
| 应用 | `POST /api/templates/:id/deepening-form/apply` | 校验通过后写入 DB |

支持上传 **.json** 或 **.zip**。ZIP 内存在 `form.json` 时优先解析；没有该文件时回退读取 `01-基本信息.csv` 至 `06-其他.csv`。基本信息 CSV 支持逗号、引号和换行的标准转义，交付文件清单以 JSON 数组写入单元格，避免文件名中的分号造成歧义。

---

## 4. 字段与匹配规则

### 4.1 基本信息

名称、尺寸、卖点、报价口径、内部参考价区间、可定制、内部备注、标签，以及整包价含税、价格基准日、安装工时、交付文件清单、EFF/RND 合并与交付备注。

旧版表单缺少新增字段时，导入使用系统现有值兜底，不把数据库中的整包价、工时、交付清单或合并留痕覆盖为空。导入只写字段数据，不上传或替换 DWG / PDF / BOM / MAN / INF 附件。

### 4.2 报价清单

| Tab | 来源字段 | 匹配 |
|-----|----------|------|
| 型材 | 长度、数量、系数、颜色 | 颜色须在启用型材色列表 |
| 六通 | `source=catalog` + `price_item_id` | 须在单价库存在 |
| 五金 | `source=catalog` + `price_item_id` | 须在单价库存在 |
| 五金 | `source=manual` 未匹配库 | 写入 **其他** Tab，同步非标库 |
| 板材 | `source=catalog` + `price_item_id` | 须在单价库存在 |
| 其他 | 手动行 | 同步 `price_items_custom` / BOM |

---

## 5. 数据与依赖

| 项 | 说明 |
|----|------|
| npm | `adm-zip`（ZIP 打包/解包） |
| 模块 | `src/deepening-form.js` |
| 路由 | `src/server.js` |

---

## 6. 改动文件

| 文件 | 改动 |
|------|------|
| `src/deepening-form.js` | 导出/预览/应用；新交付字段兼容与旧表单兜底 |
| `src/server.js` | GET json/zip、POST preview/apply |
| `public/app.js` | 当前无深化表单导入预览入口；文档不宣称存在该 UI |

---

## 7. 关联文档

- [升级摘要 2026-05-31](UPGRADE-20260531.md)
- [协作流程图](WORKFLOW.md) §5.1
- [单价库](PRICE-LIB-UPDATES.md)
- [模板列表 · 已发布只读](TEMPLATE-LIST-UPDATES.md) §7

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-11-02 | 导出与导入纳入整包价、基准日、安装工时、交付清单和 EFF/RND 合并留痕；旧表单不覆盖新字段现值 |
