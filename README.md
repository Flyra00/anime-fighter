# Anime Fighter

Game web: spin karakter anime, gabung 2 karakter jadi 1 fighter, terus battle!
Langsung main di browser, tanpa install — buka link GitHub Pages-nya, main
bareng teman di satu layar juga bisa.

## Cara main

1. **SPIN** — dapetin karakter anime (gratis tiap 60 detik, maks 3; kalau habis,
   50 Cash per spin).
2. **KOLEKSI** — klik 2 karakter, isi nama fighter, terus **GABUNG JADI FIGHTER**.
   Fighter ngambil stat terbesar dari kedua karakter, jurusnya dari yang ATK-nya
   paling besar.
3. **BATTLE VS BOT** — klik SERANG bergantian sama bot. Menang +100 Cash,
   kalah +15 Cash.
4. **DUEL TEMAN (1 LAYAR)** — teman pilih 2 karakter dari semua roster, terus
   gantian tap tombol SERANG di satu layar yang sama.
5. **SEMUA KARAKTER** — galeri 90 karakter, bisa dicari + difilter rarity.

Save otomatis di browser (localStorage), jadi koleksi + fighter lo nggak hilang
selama pakai browser yang sama.

## Roster

90 karakter dari Dragon Ball, Naruto, One Piece, Bleach, Jujutsu Kaisen,
Demon Slayer, My Hero Academia, Hunter x Hunter, One Punch Man,
Attack on Titan, JoJo, Black Clover, Fairy Tail, Chainsaw Man, Solo Leveling,
Mob Psycho 100, Fullmetal Alchemist, Tokyo Ghoul, Sword Art Online, Gintama.

Nama, asal anime, dan jurus andalan mengikuti kanon masing-masing seri.
Stat (ATK/DEF/SPD/HP) adalah angka balance game per rarity, bukan power level
resmi — tidak ada skala resmi lintas anime. Foto karakter dari Kitsu
(media.kitsu.app); kalau satu foto gagal dimuat, tampil kartu warna dengan
huruf awal nama karakter. Form (mis. Goku Super Saiyan, Luffy Gear 5) memakai
foto karakter dasar yang sama.

## Teknologi

- HTML + CSS + JS murni, tanpa build step, tanpa backend.
- Suara dibuat langsung dari code (WebAudio) — tanpa file audio.
- Rarity: Common 55% / Rare 26% / Epic 14% / Legendary 5%.
- Damage: `max(2, ATK - floor(DEF / 3))`.
