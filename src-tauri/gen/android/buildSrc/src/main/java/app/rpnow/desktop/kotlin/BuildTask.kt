import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import javax.inject.Inject
import org.gradle.process.ExecOperations

abstract class BuildTask : DefaultTask() {
    @get:Inject
    abstract val execOperations: ExecOperations

    @Input
    var rootDirRel: String? = null
    @Input
    var projectDir: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        // RPNow is built with pnpm (pnpm-lock.yaml). A bare command name is not
        // enough on Windows: Gradle resolves it to `pnpm.bat`, which does not
        // exist (pnpm ships pnpm.cmd / pnpm.ps1), so the absolute .cmd path is
        // resolved from PATH instead. RPNOW_PM overrides everything.
        val executable = resolvePackageManager()
        try {
            runTauriCli(executable)
        } catch (e: Exception) {
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                val fallbacks = listOf(
                    "$executable.exe",
                    "$executable.cmd",
                    "$executable.bat",
                )
                var lastException: Exception = e
                for (fallback in fallbacks) {
                    try {
                        runTauriCli(fallback)
                        return
                    } catch (fallbackException: Exception) {
                        lastException = fallbackException
                    }
                }
                throw lastException
            } else {
                throw e
            }
        }
    }

    /** Locate a runnable package manager command. */
    private fun resolvePackageManager(): String {
        val explicit = System.getenv("RPNOW_PM")
        if (!explicit.isNullOrBlank()) return explicit
        if (!Os.isFamily(Os.FAMILY_WINDOWS)) return "pnpm"
        // Gradle appends .bat/.cmd/.exe to whatever name it is given, so the
        // value must be a SUFFIX-LESS path to a real .bat wrapper.
        // `projectDir` here is the *app* module directory, so the repo root is
        // three levels up from it plus the configured rootDirRel.
        val candidates = listOf(
            File(projectDir, "$rootDirRel/scripts/tauri-android-build.bat"),
            File(projectDir, "../../../scripts/tauri-android-build.bat"),
            File(projectDir, "../scripts/tauri-android-build.bat"),
        )
        val wrapper = candidates.firstOrNull { it.isFile }
        logger.lifecycle("[RPNow] projectDir={} wrapper={}", projectDir, wrapper?.absolutePath ?: "<none>")
        if (wrapper != null) {
            return wrapper.absolutePath.removeSuffix(".bat")
        }
        return "pnpm"
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("run", "--", "tauri", "android", "android-studio-script");

        execOperations.exec {
            workingDir(File(projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}
