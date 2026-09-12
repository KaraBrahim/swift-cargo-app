; À la désinstallation, proposer d'effacer aussi ce que le poste a écrit chez
; l'utilisateur : la configuration (pays, adresse du hub) et le cache. Rien
; d'autre ne vit sur ce poste — les données sont sur le serveur.
; Pas de question lors d'une mise à jour : l'installeur désinstalle l'ancienne
; version en silence, et effacer la configuration à ce moment-là obligerait à
; tout ressaisir.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Supprimer aussi la configuration et les données locales de Swift Cargo sur ce poste ?$\r$\n$\r$\n(Les données de l'entreprise sont sur le serveur et ne sont pas concernées.)" \
      IDNO keepData
      RMDir /r "$APPDATA\swift-cargo-desktop"
    keepData:
  ${endIf}
!macroend
