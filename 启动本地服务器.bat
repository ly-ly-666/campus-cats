@echo off
chcp 65001 >nul
title 校园猫本地服务器
cd /d "%~dp0"
echo.
echo ========================================
echo   校园猫本地服务器
echo ========================================
echo.
echo 正在启动服务器（端口 8765）...
echo.

REM 检查 8765 端口是否被占用
netstat -an | findstr :8765 >nul
if not errorlevel 1 (
  echo [警告] 端口 8765 已被占用
  echo.
)

REM 启动 Python HTTP 服务器
start "" python -m http.server 8765

REM 等待服务器启动
timeout /t 2 /nobreak >nul

echo.
echo 服务器已启动！
echo 访问地址: http://localhost:8765/local-admin.html
echo.
echo 提示: 第一次打开 local-admin.html 需要点「选择项目文件夹」授权
echo.
echo 按任意键打开浏览器...
pause >nul

start "" http://localhost:8765/local-admin.html
