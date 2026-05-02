Original prompt: Реализуй подобное главное меню. Для рисунки заднего фона используй картинку background.png. Оставь кнопку Игра по нажатию на которую дается выбор игры за кого идет игра - за вирус или за человека(пока не реализовано). И кнопку настроек по нажатию на которую открывается меню настроек

Progress:
- Added a Plague Inc inspired main menu screen after authentication.
- Used `background.png` as the menu background through Vite asset import.
- Added the `Игра` button with a role selection modal for `За вирус` and `За человека`.
- Updated `За вирус` to show as implemented and launch the existing simulator screen; `За человека` remains not implemented.
- Connected the `Настройки` button to the existing settings modal.
- Verified `npm run build`, desktop menu flow, role dialog, settings modal, and a mobile viewport.
- Updated the menu background to use `background.png` directly, with only a light readability vignette.
- Removed the top-right placeholder/social hex buttons from the main menu.

TODO:
- Implement the human-side game mode when gameplay is ready.

Update:
- Moved scenario preface/origin/virus-details management out of the in-game sidebar.
- Expanded the pre-game scenario selection screen so the selected scenario shows all scenario information in one place.
- Verified build, TypeScript, scenario selection flow, and in-game sidebar screenshots.

TODO:
- Human-side game mode is still not implemented.
