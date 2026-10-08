/** Messages of the shared UI kit (`ui.*`). Generic labels (OK, Cancel, Close…) live in `common.*`. */
import { registerMessages } from '@/lib/i18n';

registerMessages({
  en: {
    'ui.dialog': 'Dialog',
    'ui.pickItem': 'Pick an item',
    'ui.typeToFilter': 'Type to filter…',
    'ui.noMatches': 'No matches',
    'ui.addTag': 'Add a tag…',
    'ui.suggestions': 'Suggestions',
    'ui.removeTag': 'Remove {tag}',
    'ui.qrCode': 'QR code',
    'ui.notifications': 'Notifications',
    'ui.closeNotification': 'Close notification',
  },
  es: {
    'ui.dialog': 'Diálogo',
    'ui.pickItem': 'Elige una opción',
    'ui.typeToFilter': 'Escribe para filtrar…',
    'ui.noMatches': 'Sin coincidencias',
    'ui.addTag': 'Agregar etiqueta…',
    'ui.suggestions': 'Sugerencias',
    'ui.removeTag': 'Quitar {tag}',
    'ui.qrCode': 'Código QR',
    'ui.notifications': 'Notificaciones',
    'ui.closeNotification': 'Cerrar notificación',
  },
});
