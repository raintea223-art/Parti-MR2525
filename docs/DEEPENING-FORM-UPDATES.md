# 外包深化表单 · 实施说明

> 实施日期：2026-06-04  
> 状态：**已实施**  
> 前端 UI：**20260604e**

模板详情 **外包深化表单** 卡片：将基本信息、详细报价清单与标签导出为 JSON/ZIP，供外包离线深化；支持导入预览与应用。

---

## 1. 入口与权限

| 项 | 说明 |
|----|------|
| 位置 | 模板详情 → **外包深化表单** 卡片 |
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

- `{编号}_深化表单.json` — 主数据（`format: mr2525-template-form-v1`）
- `catalog.csv` — 当前六通、五金、板材单价库快照（供外包对照选取）

---

## 3. 导入

| 步骤 | API | 说明 |
|------|-----|------|
| 预览 | `POST /api/templates/:id/deepening-form/preview` | multipart `file`；返回 diff、warnings、errors |
| 应用 | `POST /api/templates/:id/deepening-form/apply` | 校验通过后写入 DB |

支持上传 **.json** 或 **.zip**（取 zip 内第一个 `.json`）。

---

## 4. 字段与匹配规则

### 4.1 基本信息

名称、尺寸、卖点、报价口径、参考价区间、可定制、内部备注、标签。

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
| `src/deepening-form.js` | **新建** 导出/预览/应用 |
| `src/server.js` | GET json/zip、POST preview/apply |
| `public/app.js` | 详情卡片 UI、预览弹窗 |
| `public/styles.css` | `.deepening-form-*` |

---

## 7. 关联文档

- [升级摘要 2026-06-04](UPGRADE-20260604.md)
- [协作流程图](WORKFLOW.md) §5.1
- [单价库](PRICE-LIB-UPDATES.md)
- [模板列表 · 已发布只读](TEMPLATE-LIST-UPDATES.md) §7
