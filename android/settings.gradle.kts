pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google { content { includeGroupByRegex("com\\.android.*|androidx.*|com\\.google.*") } }
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        google { content { includeGroupByRegex("com\\.android.*|androidx.*|com\\.google.*") } }
    }
}
rootProject.name = "OrthoMonitoringAI"

// `core` is pure Kotlin/JVM (quality analysis, capture guide, upload queue policy) and builds anywhere.
include(":core")

// The Android app needs an Android SDK (ANDROID_HOME or local.properties sdk.dir).
val hasSdk = System.getenv("ANDROID_HOME") != null || System.getenv("ANDROID_SDK_ROOT") != null ||
    (file("local.properties").takeIf { it.exists() }?.readText()?.contains("sdk.dir") == true)
if (hasSdk) include(":app") else logger.lifecycle("Android SDK not found: building :core only")
