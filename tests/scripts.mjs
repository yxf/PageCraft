export const copyScript = `
const enhance = () => {
 document.querySelectorAll('pre').forEach(pre => {
  if (pre.querySelector('[data-copy]')) return;
  const text = pre.textContent || '';
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = '复制代码';
  button.setAttribute('data-copy', 'true');
  ctx.append(pre, button);
  ctx.on(button, 'click', () => ctx.copy(text));
 });
};
enhance();
ctx.observe(document.body, enhance);
`;
export const exportScript = `
const table = document.querySelector('table');
if (table) {
 const button = document.createElement('button');
 button.type = 'button'; button.textContent = '导出 CSV';
 ctx.append(document.body, button);
 ctx.on(button, 'click', () => {
  const rows = Array.from(table.querySelectorAll('tr')).map(row =>
   Array.from(row.querySelectorAll('th,td')).map(cell => {
    let value = cell.textContent || '';
    if (/^[=+@\\-\\t\\r]/.test(value)) value = "'" + value;
    return '"' + value.replaceAll('"', '""') + '"';
   }).join(',')
  );
  ctx.download('projects.csv', rows.join('\\r\\n'));
 });
}
`;
