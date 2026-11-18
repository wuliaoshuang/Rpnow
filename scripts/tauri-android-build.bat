@echo off
REM Wrapper used by the Tauri Android Gradle task (see BuildTask.kt).
REM Gradle appends .bat/.cmd/.exe to the executable name it is given, so the
REM command must be a suffix-less path to a real .bat file.
node "C:\Program Files\nodejs\node_modules\pnpm\bin\pnpm.mjs" %*
