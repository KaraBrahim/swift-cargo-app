# Swift Cargo — le poste de travail (Windows)

Une fenêtre sur le serveur en ligne. Le poste ne garde aucune donnée : il
affiche l'interface et parle au serveur (`CLOUD_URL`). Il apporte ce qu'un
navigateur n'a pas — une icône, une fenêtre à lui, et l'enregistrement des
documents en PDF avec une vraie boîte de dialogue.

## Construire l'installeur

Un seul installeur, pour tous les pays.

```bash
npm --prefix desktop install

# Windows (PowerShell)
$env:SWIFT_CLOUD_URL = 'https://…onrender.com'
npm --prefix desktop run dist
```

`SWIFT_CLOUD_URL` est pré-rempli dans l'installeur (`payload/defaults.json`)
pour que le poste installé parle au serveur sans configuration. Il vient de
l'environnement de construction, jamais du dépôt.

Au premier démarrage, l'application demande le pays du poste (liste
déroulante) et le range dans le fichier de configuration.

## Ce qui est installé, et où

| Quoi | Où |
|---|---|
| Le programme | `%LOCALAPPDATA%\Programs\Swift Cargo Desk` |
| La configuration | `%APPDATA%\swift-cargo-desktop\swift-cargo.env` |

```
CLOUD_URL=https://…onrender.com   # le serveur
SITE=DZ                           # le pays, code ISO, demandé au premier démarrage
PORT=47821                        # port local de l'interface ; à ne changer qu'en cas de conflit
```

À la désinstallation, l'application propose d'effacer aussi ce dossier.

## Raccourcis

Ctrl+P imprimer · Ctrl+R recharger · Ctrl +/− zoom · F11 plein écran.
