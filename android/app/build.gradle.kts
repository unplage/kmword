plugins {
    id("com.android.application")
}

android {
    namespace = "com.wordlearner.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.wordlearner.app"
        minSdk = 21
        targetSdk = 34
        versionCode = 6
        versionName = "1.2.4"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

configurations.all {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.jetbrains.kotlin") {
            useVersion("1.9.24")
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.0")
}
