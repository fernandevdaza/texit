import { registerMessages } from '@/lib/i18n';

registerMessages({
  en: {
    // Panels registered by the workspace feature
    'panel.files': 'Files',
    'panel.outline': 'Outline',
    'panel.search': 'Search',
    'panel.plugins': 'Plugins',

    // Commands
    'cmd.view.toggleSidebar': 'Toggle sidebar',
    'cmd.view.togglePdf': 'Toggle PDF preview',
    'cmd.view.toggleBottom': 'Toggle problems panel',
    'cmd.view.toggleAi': 'Toggle AI assistant',
    'cmd.view.files': 'Show files',
    'cmd.view.outline': 'Show document outline',
    'cmd.edit.findInProject': 'Find in project',
    'cmd.view.history': 'Show history & versions',
    'cmd.view.plugins': 'Manage plugins',
    'cmd.view.log': 'Show raw compile log',
    'cmd.view.problems': 'Show problems',
    'cmd.view.layoutSplit': 'Layout: editor & PDF',
    'cmd.view.layoutEditor': 'Layout: editor only',
    'cmd.view.layoutPdf': 'Layout: PDF only',
    'cmd.view.compare': 'Compare with previous version',
    'cmd.project.home': 'Go to all projects',
    'cmd.project.rename': 'Rename project',
    'cmd.project.exportZip': 'Download source as .zip',
    'cmd.project.duplicate': 'Duplicate project',

    // Command feedback
    'workspace.renameProject': 'Rename project',
    'workspace.projectDuplicated': 'Project duplicated',

    // Top bar
    'workspace.allProjects': 'All projects',
    'workspace.renameProjectMenu': 'Rename project…',
    'workspace.projectSettings': 'Project settings…',
    'workspace.downloadSourceZip': 'Download source (.zip)',
    'workspace.downloadPdf': 'Download PDF',
    'workspace.duplicateProject': 'Duplicate project',
    'workspace.revealMirror': 'Reveal mirror folder',
    'workspace.searchLauncher': 'Search files, commands, symbols…',
    'workspace.editorOnly': 'Editor only',
    'workspace.editorAndPdf': 'Editor & PDF',
    'workspace.pdfOnly': 'PDF only',
    'workspace.aiAssistant': 'AI assistant',
    'workspace.hideAiAssistant': 'Hide AI assistant',
    'workspace.togglePdf': 'Toggle PDF',

    // Activity bar
    'workspace.errorCount_one': '{count} error',
    'workspace.errorCount_other': '{count} errors',
    'workspace.lightMode': 'Light mode',
    'workspace.darkMode': 'Dark mode',
    'workspace.toggleTheme': 'Toggle theme',
    'workspace.settings': 'Settings',
    'workspace.editProfile': '{name} — edit profile',
    'workspace.profile': 'Profile',

    // Panel host
    'workspace.panelError': 'Panel error: {error}',
    'workspace.noPanels': 'No panels',
    'workspace.closePanel': 'Close panel',

    // Status bar
    'workspace.cursorPosition': 'Ln {line}, Col {column}',
    'workspace.selectedCount': '({count} selected)',

    // Workspace
    'workspace.couldNotOpen': 'Could not open this project',
    'workspace.backToProjects': 'Back to projects',
    'workspace.openingProject': 'Opening project…',
  },
  es: {
    'panel.files': 'Archivos',
    'panel.outline': 'Esquema',
    'panel.search': 'Buscar',
    'panel.plugins': 'Plugins',

    'cmd.view.toggleSidebar': 'Alternar barra lateral',
    'cmd.view.togglePdf': 'Alternar vista previa del PDF',
    'cmd.view.toggleBottom': 'Alternar panel de problemas',
    'cmd.view.toggleAi': 'Alternar asistente de IA',
    'cmd.view.files': 'Mostrar archivos',
    'cmd.view.outline': 'Mostrar esquema del documento',
    'cmd.edit.findInProject': 'Buscar en el proyecto',
    'cmd.view.history': 'Mostrar historial y versiones',
    'cmd.view.plugins': 'Administrar plugins',
    'cmd.view.log': 'Mostrar log de compilación sin procesar',
    'cmd.view.problems': 'Mostrar problemas',
    'cmd.view.layoutSplit': 'Diseño: editor y PDF',
    'cmd.view.layoutEditor': 'Diseño: solo editor',
    'cmd.view.layoutPdf': 'Diseño: solo PDF',
    'cmd.view.compare': 'Comparar con la versión anterior',
    'cmd.project.home': 'Ir a todos los proyectos',
    'cmd.project.rename': 'Renombrar proyecto',
    'cmd.project.exportZip': 'Descargar código fuente como .zip',
    'cmd.project.duplicate': 'Duplicar proyecto',

    'workspace.renameProject': 'Renombrar proyecto',
    'workspace.projectDuplicated': 'Proyecto duplicado',

    'workspace.allProjects': 'Todos los proyectos',
    'workspace.renameProjectMenu': 'Renombrar proyecto…',
    'workspace.projectSettings': 'Configuración del proyecto…',
    'workspace.downloadSourceZip': 'Descargar código fuente (.zip)',
    'workspace.downloadPdf': 'Descargar PDF',
    'workspace.duplicateProject': 'Duplicar proyecto',
    'workspace.revealMirror': 'Mostrar carpeta espejo',
    'workspace.searchLauncher': 'Buscar archivos, comandos, símbolos…',
    'workspace.editorOnly': 'Solo editor',
    'workspace.editorAndPdf': 'Editor y PDF',
    'workspace.pdfOnly': 'Solo PDF',
    'workspace.aiAssistant': 'Asistente de IA',
    'workspace.hideAiAssistant': 'Ocultar asistente de IA',
    'workspace.togglePdf': 'Mostrar u ocultar PDF',

    'workspace.errorCount_one': '{count} error',
    'workspace.errorCount_other': '{count} errores',
    'workspace.lightMode': 'Modo claro',
    'workspace.darkMode': 'Modo oscuro',
    'workspace.toggleTheme': 'Cambiar tema',
    'workspace.settings': 'Configuración',
    'workspace.editProfile': '{name} — editar perfil',
    'workspace.profile': 'Perfil',

    'workspace.panelError': 'Error del panel: {error}',
    'workspace.noPanels': 'No hay paneles',
    'workspace.closePanel': 'Cerrar panel',

    'workspace.cursorPosition': 'Lín. {line}, col. {column}',
    'workspace.selectedCount': '({count} seleccionados)',

    'workspace.couldNotOpen': 'No se pudo abrir este proyecto',
    'workspace.backToProjects': 'Volver a los proyectos',
    'workspace.openingProject': 'Abriendo proyecto…',
  },
});
