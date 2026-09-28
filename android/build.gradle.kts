// Kotlin plugins resolve from Maven Central / the Gradle Plugin Portal. The Android Gradle Plugin is declared in
// :app so that :core can build and test in environments without Google's Maven repository or an Android SDK.
plugins {
    id("org.jetbrains.kotlin.jvm") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
}
