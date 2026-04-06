# 01 · GitHub 版本管理清单

## 第一步：创建空仓库

在 GitHub 创建一个**空仓库**，不要预先勾选 README、License、.gitignore。

## 第二步：本地初始化

```bash
git init
git add .
git commit -m "init: first deployable version"
git branch -M main
```

## 第三步：绑定远程仓库

```bash
git remote add origin 你的仓库地址
git remote -v
git push -u origin main
```

## 第四步：建立分支规则

- `main`：稳定版
- `dev`：开发集成版
- `feature/*`：单功能开发
- `hotfix/*`：线上修复

## 第五步：以后每次更新

```bash
git checkout -b feature/xxx
# 修改代码
git add .
git commit -m "feat: xxx"
git push --set-upstream origin feature/xxx
```

然后在 GitHub 发 Pull Request，再合并进 `main`。
