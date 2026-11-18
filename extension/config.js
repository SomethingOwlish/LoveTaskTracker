// Настройки расширения. Всё здесь не секретно и может лежать в git.

// Адрес приложения — сюда ведут кнопки «Открыть».
export const APP_URL = 'https://lovetasktracker.argentummortis.workers.dev';

// OAuth-клиент Google «Web application» проекта tasktrackergando.
// Его ID видно в Firebase → Authentication → Sign-in method → Google →
// «Web SDK configuration» → Web client ID. В Google Cloud у этого клиента в
// «Authorized redirect URIs» должен быть адрес из REDIRECT_URI ниже.
// Подробно — extension/README.md.
export const OAUTH_CLIENT_ID = '829759743503-4i7mtbp24s16v2fobslsibrlafrch08n.apps.googleusercontent.com';

// Публичный ключ закрепляет ID расширения (ihpjoimhbgfkbcfkpcnadjnkeffckcbi),
// поэтому адрес возврата после входа не меняется при установке «распакованным».
export const EXTENSION_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvSrQA1HhwLUhY0zNQl3D/rnH+JNxfxupibpxPLpOwdOdygS0ZaGT+1zpWSHCW4Hh+Qtm78lLje6KAmZegRGJ/YOct+ffvAqBB8arnri3wQgOa08Poo6HafO0U0IB4PA+w0ymEZrkGLe6h5S6a12WSudhU1jR7DVNPj2VpBgCI7gsbDutvQy4zfhtOs4upAZlnQ+6wwS7ffaIrTMuTnWPm8phjrmamLOSfjkR7o+ADm1hsNuvOC3LxqLbGiyAe2PmoYpq3G3gZObOUW8tkgxH86kvzP6eidrvqCDCXgnJmnwaxqdYturaBIqwoewJ6fzdfOPIGoWxuFQYYmyhMMr6dQIDAQAB';
export const EXTENSION_ID = 'ihpjoimhbgfkbcfkpcnadjnkeffckcbi';
export const REDIRECT_URI = `https://${EXTENSION_ID}.chromiumapp.org/`;
