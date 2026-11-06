document.querySelector('#add').onclick = () => {
  const tr = document.createElement('tr');
  tr.innerHTML = '<td>异步加载项目</td><td>待处理</td>';
  document.querySelector('tbody').append(tr);
  const pre = document.createElement('pre');
  pre.textContent = 'const added = true;';
  document.querySelector('article').append(pre);
};
document.querySelector('#route').onclick = () =>
  history.pushState(
    {},
    '',
    location.pathname.includes('private') ? '/fixtures/article.html' : '/fixtures/private',
  );
