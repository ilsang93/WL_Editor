// local-server.js
// 간단한 Express 서버로 index.html 실행

const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// public 디렉토리에서 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// index.html 기본 라우팅
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
