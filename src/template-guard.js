const PUBLISHED_EDIT_MSG = "已发布模板不可修改，请先下架后再编辑";
const PUBLISHED_TAGS_MSG = "已发布模板仅可修改标签；其它内容请先下架";

function assertTemplateEditable(template) {
  if (!template) {
    const err = new Error("模板不存在");
    err.status = 404;
    throw err;
  }
  if (template.status === "published") {
    const err = new Error(PUBLISHED_EDIT_MSG);
    err.status = 403;
    throw err;
  }
  return template;
}

function assertEditableById(db, id) {
  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(id);
  return assertTemplateEditable(row);
}

function validatePublishedTemplatePatch(existing, body) {
  if (existing.status !== "published") return;

  const keys = Object.keys(body || {}).filter((k) => body[k] !== undefined);
  const statusChange = body.status && body.status !== existing.status;

  if (statusChange) {
    if (body.status !== "archived") {
      const err = new Error("已发布模板仅可下架，不可直接改为其它状态");
      err.status = 400;
      throw err;
    }
    const other = keys.filter((k) => k !== "status" && k !== "tags");
    if (other.length) {
      const err = new Error(PUBLISHED_TAGS_MSG);
      err.status = 400;
      throw err;
    }
    return;
  }

  if (!keys.every((k) => k === "tags")) {
    const err = new Error(PUBLISHED_TAGS_MSG);
    err.status = 400;
    throw err;
  }
}

module.exports = {
  PUBLISHED_EDIT_MSG,
  PUBLISHED_TAGS_MSG,
  assertTemplateEditable,
  assertEditableById,
  validatePublishedTemplatePatch
};
