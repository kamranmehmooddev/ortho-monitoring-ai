package ai.orthomonitoring.patient.ui.nav

import ai.orthomonitoring.patient.AppContainer
import ai.orthomonitoring.patient.ui.screens.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

@Composable
fun AppRoot(c: AppContainer) {
    val token by c.session.token.collectAsState()
    if (token == null) { ActivationScreen(c); return }
    val nav = rememberNavController()
    val back: () -> Unit = { nav.popBackStack() }
    NavHost(nav, startDestination = "home") {
        composable("home") {
            HomeScreen(c, onStartCheckin = { retake, views -> nav.navigate("checkin?retake=${retake ?: ""}&views=${views?.joinToString(",") ?: ""}") }, go = { nav.navigate(it) })
        }
        composable("checkin?retake={retake}&views={views}", arguments = listOf(
            navArgument("retake") { type = NavType.StringType; defaultValue = "" }, navArgument("views") { type = NavType.StringType; defaultValue = "" },
        )) { e ->
            val retake = e.arguments?.getString("retake").orEmpty().ifBlank { null }
            val views = e.arguments?.getString("views").orEmpty().ifBlank { null }?.split(",")
            CheckinFlow(c, retake, views) { nav.popBackStack("home", inclusive = false) }
        }
        composable("issue") { IssueScreen(c, back) }
        composable("chat") { ChatScreen(c, back) }
        composable("wear") { WearScreen(c, back) }
        composable("learn") { LearnScreen(c, back) }
        composable("progress") { ProgressScreen(c, back) }
        composable("appointments") { AppointmentsScreen(c, back) }
        composable("settings") { SettingsScreen(c, back) }
    }
}
