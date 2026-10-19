# Lot

Historia wersji: [CHANGELOG.md](CHANGELOG.md) (w grze – „Co nowego”).

Prototyp arcade'owej gry lotniczej nad prawdziwą mapą Polski, z widokiem z góry, na **WebGPU** (Three.js 0.186, `WebGPURenderer` i shadery w TSL). Gra nie ma trybu zapasowego WebGL2: bez WebGPU pokazuje okno z informacją.

**Gotowe:** teren regionu, fizyczna atmosfera, chmury wolumetryczne z cieniami na ziemi, Dromader z arcade'owym modelem lotu i kamerą pościgową, wygładzanie czasowe (TAA), efekt miniatury (tilt-shift), jeziora z falami i odbiciami, las z pojedynczych drzew 3D, a z OpenStreetMap: drogi i dukty, budynki 3D, tory z peronami, mosty, aleje, linie energetyczne i cienie budynków oraz drzew. Region: Bory Tucholskie, a w grze generator regionów z dowolnego miejsca w Polsce (kafle wektorowe OpenStreetMap).

## Uruchomienie

```bash
npm install
npm start
```

Gra działa pod adresem http://localhost:4190. Moduły ES i dane regionu nie wczytują się z `file://`, dlatego potrzebny jest serwer.

Wymagania: Chrome lub Edge (Windows/macOS), Firefox 141+ albo Safari 26+, z włączoną akceleracją sprzętową.

Sterowanie:
- **lot:** A/D (←/→) – przechył i skręt (puszczone – samolot sam się poziomuje), W/S (↑/↓) – wznoszenie i opadanie, E lub Shift – więcej gazu, Q – mniej, R – start od nowa po kraksie;
- **kamera:** C przełącza kolejno: za samolotem, kabina, swobodny; V – wprost do kabiny i z powrotem. Za samolotem: przeciąganie myszą (lewy lub prawy przycisk) – obrót wokół samolotu (pełny w poziomie, od spodu do widoku z góry), kółko – odległość (12–1500 m), dwuklik lub X – z powrotem za ogon; w ustawieniach można włączyć łagodny powrót za ogon po puszczeniu myszy. W kabinie: przeciąganie myszą – rozglądanie się, kółko – pole widzenia, dwuklik – na wprost;
- **światła:** L włącza i wyłącza reflektory do lądowania (pozycyjne, stroboskopy i błyskacz świecą zawsze). Swobodny: lewy przycisk – przesuwanie, prawy – obrót, kółko – wysokość, WASD, Q/E, R/F, Shift;
- H – panel.

Panel ma suwaki godziny (z odtwarzaniem upływu czasu), przejrzystości powietrza, zachmurzenia, siły efektu miniatury, ekspozycji i przewyższenia rzeźby. W prawym górnym rogu: prędkość, wysokość n.p.m. i nad ziemią, gaz.

Testy (Node 22+):

```bash
npm test
```

## Wersja przeglądarkowa i aplikacja desktopowa

Jak w Maszyniście i Pograniczu Galaktyki:

```bash
npm run web        # web/lot/ i web/lot-<wersja>.zip – pliki strony do wgrania na serwer
npm run app        # gra w oknie Electron (bez serwera)
npm run app:check  # samosprawdzenie aplikacji: wczytanie, szybki start, raport błędów (LOT_SHOT=plik.png – zrzut)
npm run dist       # instalator NSIS i wersja przenośna dla Windows w dist/
npm run dist:dir   # tylko rozpakowana aplikacja w dist/win-unpacked
npm run icon       # ikony: favicon.ico, icons/, build/icon.png
```

- **Web** (`tools/web.js`): `index.html`, `style.css`, ikony, `src/`, `vendor/three/` i `data/regions/` (bez podglądów i opisów), ok. 125 MB (trzy regiony). Wystarczy dowolny serwer statyczny, ale WebGPU działa tylko w bezpiecznym kontekście – strona musi być podana przez HTTPS (albo z localhost). Dane `.gz` gra rozpakowuje sama; gdy serwer doda do nich `Content-Encoding: gzip`, też działa. Podgląd zbudowanej wersji: `node server.js web/lot`.
- **Electron** (`electron/`): pliki gry podaje protokół `app://game` (moduły ES, mapa importów, `fetch` danych i `localStorage` działają jak na serwerze), proszona jest wydajna karta graficzna. F11 / Alt+Enter – pełny ekran, okno pamięta rozmiar i położenie, w menu głównym jest „Wyjdź z gry”. Izolacja kontekstu i piaskownica; stronie udostępnione jest tylko `window.desktop` (pełny ekran, wyjście). Ctrl+Shift+I – narzędzia deweloperskie (tylko wersja niespakowana).
- **Pakowanie** (`tools/dist.js`, electron-builder): Electron brany z `node_modules/electron/dist` (bez pobierania). Dwuczęściowa wersja (0.7) jest na czas budowania zamieniana na trzyczęściową (0.7.0).

## Teren z prawdziwych danych

`npm run bake -- <region>` wypieka region do `data/regions/<id>/`. Dane wynikowe są w repozytorium, więc do grania nie trzeba ich pobierać.

| Plik | Zawartość | Źródło |
|---|---|---|
| `height.bin.gz` | wysokość, Uint16, 2048² (≈ 22 m) | AWS Terrain Tiles (Terrarium, z12) |
| `cover.bin.gz` | pokrycie terenu, Uint8, 4096² (≈ 11 m) | ESA WorldCover 2021 v200 (10 m), czytany wprost z COG zapytaniami Range |
| `shore.bin.gz` | odległość od brzegu ze znakiem | wyliczana z wody w pokryciu |
| `osm.json.gz` | drogi, tory, budynki, cieki, linie energetyczne, szpalery, stacje, przejazdy, perony | OpenStreetMap przez Overpass (`npm run bake:osm`) |
| `meta.json` | granice, zakresy, procent klas, licencje | |

Dodatkowo przy wypiekaniu:
- tafle jezior są wyrównywane do jednego poziomu, a rzeki dostają gładki nurt bez szumu SRTM;
- ląd przy brzegu nie może leżeć poniżej wody.

OSM pobiera `npm run bake:osm` w 64 kafelkach z kilku serwerów Overpass. Serwery bywają przeciążone, więc narzędzie czeka, ponawia, a kafelki, których się nie udało pobrać, pomija. Kolejne uruchomienie dobiera tylko brakujące, bo pobrane są w pamięci podręcznej. `--cached-only` składa plik z tego, co już jest. Pobrane kafelki trafiają do `tools/.cache/`. `node tools/preview-region.js` zapisuje podgląd regionu (`preview.png`, pokrycie z cieniowaniem rzeźby) do sprawdzenia danych bez gry.

Regiony definiuje `src/regions.js`. Wbudowane są trzy, każdy 46 × 46 km:

| Region | Dane | Budynki | Pliki |
|---|---|---|---|
| **Zabrze** (domyślny) – Gliwice, Katowice, Bytom, Ruda Śląska, Chorzów | kafle OpenStreetMap, rzeźba szczegółowa | 470 tys. | 53 MB |
| **Beskid Śląski** – Szczyrk, Bielsko-Biała, Wisła, Ustroń, Żywiec, Skoczów; do 1549 m | kafle OpenStreetMap, rzeźba szczegółowa | 272 tys. | 46 MB |
| **Bory Tucholskie** – Tuchola, Charzykowy, Brda, Chojnice | ESA WorldCover i Overpass | 73 tys. | 14 MB |

Regiony z polem `gen` wypieka `npm run bake:gen -- <id>` (`tools/bake-gen.js`) tym samym rdzeniem co generator w grze
(`src/gen/build.js`), z miejscami startu i odmianą nazw z `src/regions.js`; kafle zostają w `tools/.cache/tiles/`.
Zabrze to ponad 6 razy więcej budynków niż Bory – gra zajmuje wtedy ok. 2 GB pamięci.

## Nawigacja w locie

- **Pasek kursu** u góry ekranu: taśma kompasu (N, NE, E… i co 30°), kurs w stopniach; przy granicy mapy – czerwony
  znacznik kursu powrotu.
- **Panel położenia** (lewy dół): gdzie jesteśmy – „nad Zabrzem · Biskupice” (miasto i dzielnica), „nad miejscowością
  Rytel”, poza zabudową „6 km na płn.-zach. od Tucholi” (od miejscowości bliskiej i ważnej, nie od najbliższego
  przysiółka); współrzędne geograficzne i region; **wiatr względem samolotu** (strzałka, prędkość, czołowy / w ogon /
  boczny z lewej lub prawej, skąd wieje); **ostrzeżenie o granicy mapy** poniżej 3 km z kursem powrotu.
- **Minimapa** (`src/ui/minimap.js`, prawy dół): panel w stylu pozostałych (zaokrąglony kwadrat) z wycinkiem mapy bazowej regionu – pokrycie terenu w barwach
  mapy turystycznej z cieniowaniem rzeźby, cieki, drogi (główne z obwódką, lokalne na biało), tory; 4096² (11 m na
  piksel), budowana po wczytaniu porcjami (~0,75 s, bez zacięcia menu). Skale 2 / 5 / 15 km (**N**), kurs albo północ
  u góry (**Shift+N**), nazwy miejscowości dobrane do skali (bez nakładania), miejsca startu, pierścień połowy
  promienia, strzałka samolotu; cel poza zasięgiem – strzałka na brzegu. Ustawienie zapamiętywane; wyłączenie – Ustawienia → Interfejs → Minimapa.
- **Duża mapa i cel lotu** (`src/ui/bigmap.js`, **Tab** albo menu pauzy → „Mapa i cel lotu”): cały region z mapy
  bazowej, przesuwanie (przeciąganie) i powiększanie kółkiem wokół kursora, nazwy dobrane do powiększenia, podziałka,
  miejsca startu, samolot. Kliknięcie – **cel lotu** (przyciąga do pobliskiej nazwy, inaczej punkt), prawy przycisk –
  bez celu. Na mapie czas stoi (jak na pauzie). Prowadzenie do celu: w panelu „Cel: Bytom · 10 km · 3 min · skręć 107°
  w prawo” (na kursie / nad celem), niebieski znacznik na pasku kursu, znacznik albo strzałka na brzegu minimapy,
  komunikat przy osiągnięciu celu; cel zapisuje się z lotem.
- **Nazwy miast w krajobrazie** (opcja w Ustawienia → Interfejs): podpisy miast i miasteczek 0,8–15 km przed
  samolotem, najbliższe 12.
- **Nazwy miejscowości** w danych regionu (`meta.labels`: miasta, wsie, dzielnice, przysiółki – do 900): z warstwy
  „place” kafli OpenFreeMap – `npm run bake:labels -- <region>` dopisuje je do istniejącego regionu (Zabrze 900,
  Beskid Śląski 900, Bory Tucholskie 560), generator w grze zapisuje je od razu. Do nich – odmiana nazw miejsc
  startu z `src/regions.js`.

## Skok w dowolne miejsce (tryb deweloperski)

Ustawienia → **Panel deweloperski** (klawisz H): pole **Skok do** – nazwa miejscowości (Nominatim, jak generator;
kilka wyników – lista: rodzaj miejsca, powiat i województwo, odległość i kierunek od samolotu – `placeKind`,
`placeArea`, `distDir`) albo współrzędne (`src/ui/jump.js`: `parseCoords` – „50.06, 19.94”, przecinki dziesiętne,
litery N/E, odwrócona kolejność dla Polski); przyciski **Start**, **+10 km** w kierunku lotu i 5 ostatnich skoków
(`lot-jumps` w pamięci przeglądarki). Na **dużej mapie** (Tab) **Shift+klik** – skok w to miejsce. Samolot ląduje
400 m nad terenem z tym samym kursem i prędkością. Otwarty świat: do 150 km – przesunięcie początku układu i doczytanie
okolicy (karta wczytywania), dalej – otwarty świat od nowa w tym miejscu; region – tylko w jego granicach, poza nimi
– otwarty świat w tym miejscu. W konsoli: `await __lot.jumpTo({ lat, lon, name })`.

## Czas w grze

Zegar w locie płynie: **zatrzymany**, **rzeczywisty** (×1), **przyspieszony ×10** albo **szybki ×60** (godzina w minutę –
zachód słońca na żywo). Tempo w planie lotu, w menu pauzy (Pogoda i pora) i klawiszami: **T** – zatrzymaj / wznów,
**Shift+T** – następne przyspieszenie (×1 → ×10 → ×60). Przez północ zegar przechodzi do następnego dnia (data,
faza Księżyca). W menu, na pauzie i podczas wczytywania czas stoi. Zegar z datą i tempem w panelu lotu; tempo
zapisuje się z lotem. Pora dnia napędza słońce, księżyc, światła miast, ruch, ptaki i pieszych.

## Ruch uliczny

`src/traffic/`: samochody, dostawczaki, ciężarówki i autobusy na drogach regionu.

- **Sieć dróg** (`graph.js`): graf z dróg z ruchem samochodowym (autostrady … dojazdowe) – węzły na końcach i w punktach
  wspólnych kilku dróg, końce pocięte na granicach kafli łączone w siatce 0,5 m. Kafle wektorowe upraszczają linie i gubią
  punkty skrzyżowań, więc przy wczytaniu `joinRoads` przyciąga końce dróg leżące < 1,5 m od innej drogi i wstawia wspólne
  punkty w przecięciach (nie na mostach i nie między poziomami). Drogi mają kierunek jednokierunkowy (`oneway` w danych:
  z tagów OSM, autostrady i ronda domyślnie; w kaflach – pole `oneway`). Zabrze: 110 tys. krawędzi, ok. 1,5 s.
- **Symulacja** (`sim.js`): pojazdy w promieniu 2,5 km od samolotu (w widoku swobodnym – od celu kamery), gęstość
  z klasy drogi × pora dnia (szczyty rano i po południu, noc spokojna) × pogoda × ustawienie; prędkość drogi
  (autostrada 120 km/h, miasto 50, osiedla 40), odstęp od poprzedzającego, na skrzyżowaniach dalsza droga podobnej lub
  ważniejszej klasy, zawracanie tylko w ślepych uliczkach; ruch prawostronny, na jednokierunkowych losowy pas; na mostach
  po pomoście. Ok. 1000 pojazdów – 0,5 ms na klatkę.
- **Obraz** (`render.js`): proste bryły z instancjami (położenie, kierunek, kolor lakieru w atrybutach, obrót w
  shaderze), nocą reflektory i czerwone światła tylne jako poświaty.
- **Dźwięk**: szum opon i silników w pobliżu ruchliwych dróg.
- Ustawienia → Obraz → **Ruch uliczny**: wyłączony / mały / normalny / duży.

## Ruch kolejowy

`src/traffic/trains.js` (logika, testowana w Node) i `trainview.js` (obraz):

- **Sieć torów**: ten sam graf co dla dróg (szlaki, bocznice, wąskotorowe; bez nieczynnych), z łączeniem rozjazdów.
  Stacje i przystanki z danych przypięte do najbliższego toru (Zabrze: 66 z 67).
- **Pociągi** w promieniu 6 km od samolotu (ok. 1 na 10 km szlaków, do 10): regionalne zespoły elektryczne (barwy
  Polregio, Kolei Śląskich), Intercity (lokomotywa i wagony), towarowe (węglarki z węglem albo cysterny, 17–32 wagony)
  i wąskotorowe. Prędkości 25–120 km/h, przyspieszanie i hamowanie; osobowe stają na każdej stacji i przystanku
  (25–45 s), Intercity tylko na stacjach, towarowe przejeżdżają.
- **Jazda**: pociąg to ścieżka z kolejnych krawędzi (z zapasem przed czołem i za ogonem), wagony w swoich odległościach
  od czoła – na łukach skład się wygina, na wzniesieniach pochyla. Na rozjazdach tylko przejścia łagodne (< ~40°),
  szlak przed bocznicą; na końcu toru pociąg staje i zmienia kierunek (jak skład wahadłowy).
- **Obraz**: wagony z instancjami (dwie barwy malowania, pochylenie), nocą oświetlone okna osobowych, trzy reflektory
  na czole i czerwone światła końca składu.
- **Dźwięk**: dudnienie i stukot wózków w pobliżu, sygnał przy odjeździe ze stacji.
- Ustawienia → Obraz → **Ruch kolejowy**.

## Ptaki

`src/fauna/birds.js` (logika, testowana w Node) i `birdview.js` (obraz):

- **Gatunki z miejsca, pory i pogody**: stada szpaków nad polami i łąkami (o zmierzchu kilkukrotnie większe, falujące),
  bociany nad łąkami i mokradłami (wiosna–lato, szybują), myszołowy krążące w kominach termicznych (pogodne
  popołudnia), mewy nad wodą, wrony nad miastami i polami. Nocą i w burzy – brak, w deszczu mniej, w śniegu tylko wrony
  i trochę mew. Klasa pokrycia terenu z mapy regionu.
- **Lot**: stada jak „boidy” (spójność, wyrównanie, odstęp) za wędrującym celem, wysokość nad terenem; grupy pojawiają
  się głównie przed samolotem (150–1500 m – w kadrze kamery), te daleko za nim ustępują miejsca nowym.
- **Samolot płoszy** stado bliżej niż ~140 m (ucieczka w bok i w dół, szybsze machanie); ptak bliżej niż ~3 m od
  kadłuba – **zderzenie** (uderzenie w dźwięku i komunikat).
- **Modele** (`birdmodels.js`): osobna bryła każdego gatunku z parametrów (130–200 trójkątów) – tułów z przekrojów,
  głowa, dziób, ogon-wachlarz, skrzydła z nasadą, nadgarstkiem i końcem; bocian z długą szyją, czerwonym dziobem
  i nogami za ogonem; myszołów, wrona i bocian z rozcapierzonymi lotkami; mewa ze skrzydłami w „W”, szpak ze
  spiczastymi. Barwy upierzenia w wierzchołkach (grzbiet, brzuch, skrzydło, tylna krawędź, końce).
- **Animacja** (shader, `birdview.js`): skrzydło zgina się w barku i nadgarstku – szybkie uderzenie w dół, wolniejszy
  powrót z ugiętą dłonią; tułów podskakuje w rytmie; w szybowaniu „V”. Rytm gatunku: szpak – serie machnięć
  z krótkim szybowaniem, bocian i myszołów – głównie szybują, mewa – kołysze. Przechył w zakręcie (z prędkości
  kątowej), dziób w górę przy wznoszeniu. Jedno rysowanie na gatunek.
- **Z daleka – punkty** (`birddots.js`): poniżej ~4 pikseli rozpiętości bryła znika, od ~6 pikseli w dół pojawia się
  kropka (~4 px) w barwie gatunku, migocząca w rytmie machania – stado szpaków z wysokości to ruchoma chmura kropek,
  a nie sztucznie powiększone ptaki. Kropki w osobnej nakładce po wygładzaniu TRAA (drobne, szybkie punkty inaczej
  rozmywają się do zera), zasłaniane z głębi sceny.
- **Wektory ruchu ptaków** liczone w materiale (przesunięcie ptaka od poprzedniej klatki i poprzednia kamera) –
  wbudowany wektor Three.js bierze poprzednie położenie z surowej bryły (bez instancji), więc wygładzanie dostawało
  zły ruch; teraz skrzydła i tułów nie zostawiają smug.
- **Dźwięk**: świergot szpaków, klekot bocianów, „kiii-ja” myszołowa, krzyk mew, krakanie wron, trzepot spłoszonego stada.
- Ustawienia → Obraz → **Ptaki**.

## Piesi

`src/fauna/people.js` (logika, testowana w Node) i `peopleview.js` (obraz):

- **Gdzie**: chodniki ulic (obok jezdni, po jednej stronie), deptaki i ścieżki – w zabudowie; ok. 12% czeka na
  peronach. Drogi główne i zbiorcze – tylko w zabudowie i nie dwujezdniowe; poza zabudową – tylko nieliczne ścieżki
  (`walkable`). Po autostradach, drogach ekspresowych i duktach nikt nie chodzi, a na skrzyżowaniach piesi skręcają
  tylko w krawędzie dla pieszych; jednokierunkowe nie obowiązują, czasem ktoś zawraca.
- **Ilu**: ~22 osoby na km chodnika w promieniu (`PER_KM`, długość części krawędzi w kole), najwyżej 1500 – na wsi
  kilkunastu, w śródmieściu setki.
- **Kiedy**: widoczni tylko z niska, więc symulowani, gdy kamera jest poniżej ~350 m nad ziemią, w promieniu 800 m;
  natężenie z godziny (południe i popołudnie) i pogody (w deszczu mniej, w burzy prawie nikt).
- **Sieć ścieżek** budowana na bieżąco w kwadratach 2 km wokół kamery – najwyżej jeden kwadrat na klatkę (do ~40 ms
  w centrum Zabrza przy pierwszym zejściu nisko), pamięć kilkunastu kwadratów.
- **Obraz**: figurka (nogi, tułów, ręce, głowa) z instancjami, krok – wymach nóg i rąk w shaderze; losowe ubrania,
  wzrost; w deszczu parasole. Atrybuty instancji upakowane (WebGPU – najwyżej 8 buforów wierzchołków).
- **Dźwięk**: gwar w pobliżu ludzi.
- Ustawienia → Obraz → **Piesi**.

## Pogoda

Plan lotu i pauza: **pogoda** (bezchmurnie … mgliście, **deszcz**, **śnieg**, **burza**) i **wiatr** (cisza, słaby,
umiarkowany, silny, wichura). Logika – `src/weather/weather.js` (testowana w Node), obraz – `src/weather/precip.js`:

- **opady**: do 48 tys. kropli lub płatków liczonych w całości na GPU w sześcianie wokół kamery (zawijanie modulo),
  spadających z wiatrem; smuga budowana w przestrzeni ekranu z dwóch rzutowanych końców (prędkość kropli względem
  kamery – z lecącego samolotu deszcz pędzi na szybę), zasłanianie z głębi sceny; osobna scena dodawana po
  wygładzaniu TRAA (cienkie, szybkie smugi nie rozmazują się); w oddali – szara zasłona opadu;
- **chmury**: przy opadach niska podstawa, gruba i gęsta warstwa, prawie pełne zachmurzenie; większe zamglenie;
- **śnieg na ziemi**: pola i korony drzew bieleją stopniowo (płaskie miejsca, w plamach), woda nie;
- **burza**: błyskawice co 4–14 s w odległości 1,5–12 km – kanał z odgałęzieniami, rozświetlenie nieba i chmur,
  grzmot opóźniony o czas biegu dźwięku (bliski z trzaskiem, daleki – pomruk); zawsze co najmniej silny wiatr;
- **wiatr**: z zachodu, z wolnym skręcaniem i porywami; znosi samolot, przesuwa chmury i kierunek opadu,
  **turbulencja** (gładka suma sinusoid, silniejsza w burzy i przy ziemi) buja przechyłem, wysokością i kursem;
  wiatr i jego kierunek w raporcie lotu na pauzie;
- **dźwięk**: szum deszczu, bębnienie o osłonę w kabinie, wiatr z porywami także przy małej prędkości, grzmoty.

## Dźwięk

Cały dźwięk jest syntezowany w Web Audio (`src/audio/audio.js`) – bez plików nagrań. Poziomy i częstotliwości liczy
`src/audio/mix.js` (testowany w Node):

- **silnik**: ton zapłonów z obrotów (obroty śmigła × przełożenie × cylindry / 2) z harmonicznymi zależnymi od
  silnika – Dromader (gwiazdowy ASz-62 z reduktorem, basowy i nierówny), Wilga (gwiazdowy AI-14), Extra (bokser
  Lycominga, ostrzejszy); kołysanie z obrotu wału, nasycenie, filtr otwierający się z gazem;
- **wydech**: szum w paśmie pulsujący z częstotliwością zapłonów;
- **śmigło**: świst modulowany przejściem łopat i niski ton łopat;
- **wiatr** (dwa pasma szumu różowego z podmuchami) rośnie z prędkością, **toczenie** po ziemi;
- **brzęczyk przeciągnięcia**, **przyziemienie** (uderzenie podwozia i pisk opon zależny od opadania), **kraksa**
  (uderzenie, gięta blacha), wybieg silnika po kraksie;
- widok: w kabinie głośno i z przytłumioną górą, z zewnątrz – spadek z odległością kamery i tłumienie wysokich tonów;
  w menu silnik krążącego samolotu cicho w tle; pauza przytłumia wszystko, wczytywanie wycisza;
- **menu**: wskazanie, kliknięcie, wybór, powrót, przełącznik, sygnał gotowości po wczytaniu.

Ustawienia → **Dźwięk**: włączenie, głośność, silnik i śmigło, wiatr i otoczenie, dźwięki menu; **M** – szybkie
wyciszenie. Przeglądarka pozwala na dźwięk dopiero po geście – kontekst powstaje przy pierwszym kliknięciu lub
klawiszu (ekran startowy), w karcie w tle jest wstrzymany.

## Grafika

- **Atmosfera** (`src/atmosphere/`) według modelu S. Hillaire'a (2020), liczona na GPU:
  - tablice przepuszczalności i rozpraszania wielokrotnego;
  - widok nieba z wysokości kamery przeliczany co klatkę;
  - natężenie światła nieba do oświetlenia terenu.

  Ziemia jest kulą, więc horyzont i krzywizna wychodzą same. Teren dalej od kamery opada zgodnie z krzywizną.
- **Perspektywa powietrzna:** każdy piksel terenu dostaje światło rozproszone i osłabienie na drodze do kamery. Liczba kroków zależy od odległości. Suwak „Powietrze” to ilość aerozoli: od krystalicznie czystego powietrza do mgły.
- **Teren** (`src/terrain.js`), materiały proceduralne w TSL, z detalem wygaszanym wraz z wielkością piksela (bez migotania):
  - pola w strefach o różnym charakterze (wąskie pasy albo duże pola), z miedzami, uwrociami, ścieżkami technologicznymi i rzędami kukurydzy; skład upraw na koniec czerwca;
  - bory: siatka oddziałów z duktami, prostokątne wydzielenia w różnym wieku, zręby, korony sosen oświetlone od strony słońca;
  - zabudowa: działki, domy z dwuspadowymi dachami, ulice, ogrody z drzewami;
  - łąki: suchsze płaty, drobna niejednorodność runi, kępy krzewów i pojedyncze drzewa.
- **Woda w jeziorach:**
  - fale z kafelkowanej mapy nachyleń (widmo fal o całkowitych wektorach falowych, bez szwów) w trzech skalach i kierunkach, z poziomem szczegółów zależnym od wielkości piksela;
  - wiatr w plamach: gładkie „lustra” i zmarszczone pasy;
  - Fresnel, odbicie nieba z atmosfery, odblask słońca GGX (z daleka szeroka smuga zamiast iskier);
  - odbicie ściany lasu i zboczy przy brzegu: marsz promienia odbitego po mapie wysokości i lasu;
  - głębia z odległości od brzegu i pochłanianie (turkusowe płycizny, granatowa głębia), piana na linii brzegu.
- **Las 3D** (`src/forest.js`): pojedyncze drzewa wokół kamery (do 1,1 km), rozstawiane w całości na GPU.
  - Siatka komórek co 5 m, stała w świecie, w każdej komórce najwyżej jedno drzewo.
  - Rozstawienie wynika z mapy lasu i logiki drzewostanów wspólnej z teksturą koron (`src/gfx/stand.js`): dukty i zręby są puste, młodniki niskie, a liściaste w swoich wydzieleniach.
  - Trzy kształty w jednej geometrii: dojrzała sosna (wysoki pień, parasol korony), młoda sosna (stożek), drzewo liściaste (kula). Dwa poziomy szczegółów (7 i 4 boki), na skraju zasięgu drzewa znikają rozpraszaniem pikseli.
  - Światło: słońce i niebo z atmosfery, cień chmur, miękkie „owinięcie” i prześwit pod słońce. Wektory ruchu są liczone z pozycji świata, więc TAA nie rozmazuje drzew.
  - W zasięgu drzew teren pokazuje zamiast tekstury koron dno lasu (ściółkę i cień), w młodnikach częściowo.
- **Drogi i dukty** (`src/roads.js`): wstęgi położone dokładnie na trójkątach siatki terenu.
  - Szerokość z klasy albo z tagów, nawierzchnia: asfalt, kostka, bruk, szuter, piasek.
  - Linie krawędziowe i przerywana oś na drogach publicznych, koleiny i trawa pośrodku dróg polnych i leśnych (prawdziwe dukty zamiast wymyślonych).
  - Krawędzie i wąskie drogi z daleka wygładzone przezroczystością, a maska dróg i torów nie pozwala drzewom stawać na jezdni.
- **Budynki** (`src/buildings.js`): obrysy z OSM wyciągnięte na wysokość z pięter albo domyślną dla rodzaju.
  - Domy i budynki gospodarcze o kształcie zbliżonym do prostokąta mają dach dwuspadowy wzdłuż dłuższego boku, bloki, hale i obrysy nieregularne płaski.
  - Kościoły dostają wieżę z hełmem.
  - **Budowle bez okien** rozpoznawane z kształtu (`src/gfx/structures.js`) – kafle OpenMapTiles nie podają rodzaju
    budynku (tylko wysokość, kolor i `hide_3d`), a w OSM kominy bywają zwykłym `building=yes`. Obrys prawie okrągły
    (kołowość 4πA/P² ≥ 0,85, ≥ 7 wierzchołków): smukły i wysoki → **komin** (ceglany albo betonowy, od 100 m
    biało-czerwone pasy przeszkodowe), wysoki i szeroki → **chłodnia kominowa** (powłoka hiperboloidy, ciemne
    wnętrze), niższy → **zbiornik / silos**. Bez siatki okien i bez świateł w oknach; kominy i chłodnie od 45 m mają
    nocą migające czerwone światła przeszkodowe (nad wylotem, a przy wysokich także niżej na trzonie).
    W Zabrzu: 96 kominów, 9 chłodni (m.in. Elektrownia Łaziska), 29 zbiorników.
  - Kolory dachów i elewacji typowe dla Pomorza, okna z siatki pięter.
- **Kolej** (`src/rails.js`): nasyp z tłuczniem, podkłady i szyny (1435 mm) z błyskiem na główkach. Tory nieczynne są zarośnięte i rdzawe, rozebrane to sam nasyp.
- **Mosty i perony** (`src/bridges.js`): pomost z bocznymi ścianami, bariery i filary do gruntu, perony jako podniesione płyty.
- **Rzeki** (`src/rivers.js`): wstęgi wody z linii OSM (rzeki, kanały, strugi ≥ 2 m), bo wąska Brda prawie nie występuje w WorldCover. Mają toń, odbicie nieba z Fresnelem, zmarszczki i odblask słońca. Wzdłuż koryt maska lasu wycina pas nadbrzeżny, więc mosty nie stoją nad drzewami.
- **Detale** (`src/details.js`): aleje (szpalery z OSM i co trzecia droga lokalna poza zabudową i lasem), linie energetyczne z kratowymi słupami lub betonowymi słupkami i przewodami ze zwisem.
- **Mapa cieni świata** (`src/shadows.js`): budynki, drzewa, mosty i słupy renderowane od słońca do 4096² w kwadracie 2,8 km wokół kamery, przyciągniętej do siatki tekseli. Dwie mapy na zmianę, bo rzucające cień same też ją próbkują. Rzucają ją osobne, tanie siatki bez oświetlenia.
- **Oświetlenie:** słońce po przejściu przez atmosferę, światło nieba i odbite od okolicy. Cienie rzucają rzeźba terenu i ściany lasu, liczone marszem promienia po mapie wysokości z 17-metrową warstwą koron.
- **Słońce** liczone algorytmem NOAA dla daty i miejsca (21 czerwca, czas letni). Automatyczna ekspozycja zależy od natężenia światła.
- **Chmury** (`src/clouds/`): warstwa cumulusów między 1500 a 3100 m, wyznaczona dwiema sferami nad zakrzywioną Ziemią. Widać je z góry, z dołu i ze środka (przelot przez chmurę). Szczegóły:
  - gęstość z kafelkowanej mapy pogody (skupiska i wysokość wierzchołków), szumu kształtu Perlin–Worley 64³ i szumu detalu Worley 32³, generowanych na starcie (~0,65 s);
  - płaskie podstawy i kopuły zależne od zasięgu; detal daje strzępy u podstawy i „kalafior” u góry (przepis z Horizon Zero Dawn);
  - marsz promienia z krokiem rosnącym z odległością (40–400 m), 5 próbek w stronę słońca, trzy „oktawy” rozpraszania wielokrotnego (Wrenninge), efekt „powder”, światło słońca i nieba z atmosfery;
  - połowa rozdzielczości, drganie kroku i akumulacja czasowa z reprojekcją, wygładzanie przy powiększaniu;
  - wiatr przesuwa pogodę, mgiełka między kamerą a chmurą jest liczona z tej samej atmosfery;
  - cień chmur na ziemi: trzy próbki gęstości wzdłuż promienia słońca w materiale terenu.

  Uwaga do TSL: zagnieżdżony `If` wewnątrz łańcucha `If/ElseIf/Else` dawał zły kod, dlatego odcinek promienia w warstwie liczą wyrażenia `select`.
- **Menu** (`src/ui/`) w stylu Pogranicza Galaktyki i Maszynisty:
  - ekran startowy z logo, paskiem wczytywania i „Kliknij lub naciśnij dowolny klawisz”;
  - menu nad żywą sceną: Dromader krąży na autopilocie, kamera powoli go okrąża, przyciemnienie od lewej; rama z celownikami w rogach i pasem skanu, marka u góry, stopka z wersją;
  - ekran główny: Kontynuuj lot (autozapis), Szybki start, Nowy lot, Wczytaj lot, Ustawienia, Sterowanie; obok karta „Plan lotu”;
  - plan lotu: miejsce startu (Tuchola, Jezioro Charzykowskie, Chojnice, Rytel, Czersk, Człuchów), pora dnia, pora roku (wiosna, lato, wczesna jesień, zima – śnieg i drzewa bez liści), pogoda i widok – wybór od razu zmienia scenę w tle;
  - pauza (Esc): Wznów, Pogoda i pora dnia, Zapisz / wczytaj – jeden ekran jak w Maszyniście: przy każdym z 5 slotów i autozapisie przyciski Zapisz (Nadpisz), Wczytaj i ✕ (usuń); nadpisanie, usunięcie i wczytanie w locie wymagają drugiego kliknięcia („NA PEWNO?”); autozapis co 30 s i przy wyjściu do menu; z ekranu głównego i po kraksie ten sam ekran tylko do wczytywania, Ustawienia, Sterowanie, Menu główne, z raportem lotu (położenie „2 km na płd.-wsch. od Tucholi”, prędkość, wysokość, kurs, czas);
  - kraksa jako okno z „Leć ponownie” (Enter), „Wczytaj lot”, „Menu główne”;
  - ustawienia w zakładkach Obraz / Sterowanie / Interfejs (miniatura, ekspozycja, rozdzielczość, przewyższenie, odwrócona oś, czułość myszy, pole widzenia w kabinie, panel lotu, licznik klatek, ograniczenie animacji, panel deweloperski) – zapamiętywane w `localStorage` (klucze `lot-…`);
  - ekrany wczytywania jak w Maszyniście (`src/ui/loading.js`): przy starcie lotu, wczytaniu zapisu i ponownym starcie – pełny ekran z animowanym tłem 2D (przelot nad polami, lasami, rzeką i drogami, sylwetka samolotu z cieniem i światłami, chmury; nocą światła osad, samolot zwalnia w miarę postępu) i kartą: linia nagłówkowa (rodzaj wczytywania, rejestracja, samolot), miejsce, opis lotu, pasek z etapem i procentem, wskazówka; praca rozłożona na klatki, na końcu rozgrzewka za kartą (kompilacja shaderów, chmury, wygładzanie), więc lot zaczyna się bez przycięć;
  - mała karta nad menu przy zapisie lotu („Lot zapisany · slot 3”) i przy pierwszym wyborze samolotu w planie lotu (budowa modelu i kompilacja materiałów); gdy przeglądarka wstrzyma klatki (okno w tle), kroki kończą się na zegarze;
  - Esc cofa o poziom, Enter startuje; przyciski z podświetleniem krawędzi i przebiegiem światła, szklane okna z narożnikami i linią skanu; `prefers-reduced-motion` wyłącza animacje.
- **Samoloty do wyboru** (`src/plane/aircraft.js`, wybór w planie lotu – sekcja „Samolot”):
  - **PZL M-18 Dromader** – rolniczy dolnopłat (opis niżej);
  - **PZL-104 Wilga 35** (`wilga.js`) – górnopłat STOL: przeszklona kabina z oknami aż do kolan (widok w dół przez drzwi), skrzydło ze stałymi slotami, silnik gwiazdowy z dwułopatowym śmigłem, wysokie podwozie na wahaczach; lata wolno (przeciąga ~60 km/h), stromo się wznosi; malowanie aeroklubowe biało-czerwone, SP-WGA, dwa fotele;
  - **Extra 330LX** (`extra.js`) – akrobacyjny: kroplowa owiewka, zbieżne skrzydło o profilu symetrycznym z lotkami na prawie całej rozpiętości, trójłopatowe śmigło, owiewki kół; szybki (do ~345 km/h, Vne ~407 km/h) i zwinny – lotki obracają go bez ograniczeń (~300°/s), więc można robić beczki i lecieć na plecach (ster wysokości działa wtedy odwrotnie względem ziemi); puszczony blisko poziomu sam się wyrównuje; biel z czerwono-granatowym pasem i promieniami słońca na skrzydłach, SP-AKR;
  - **PZL Mielec An-2** (`an2.js`) – dwupłat: górne skrzydło na grzbiecie nad kabiną (sloty, lotki), dolne przy podłodze, słupki „I” i stalowe cięgna, silnik gwiazdowy w osłonie z żaluzjami i wlotem gaźnika, czterołopatowe śmigło, okrągłe okna kabiny pasażerskiej i drzwi, usterzenie z zastrzałami; najwolniejszy w hangarze (przeciąga ~55 km/h, do ~225 km/h), ociężały w przechyle; biel z czerwienią, SP-ANT, dwa fotele obok siebie;
  - **PZL-130 Orlik** (`orlik.js`) – turbośmigłowy szkolny: długi nos z rurami wydechowymi i wlotem pod kołpakiem, pięciołopatowe śmigło, owiewka tandem (instruktor z tyłu), zbieżny dolnopłat ze wzniosem, skośny statecznik; akrobacyjny jak Extra, ale wolniej się obraca (~170°/s), do ~415 km/h; podwozie trójkołowe chowa się samo powyżej ~180 km/h (główne do skrzydeł, przednie do tyłu, ~5 s); biel z czerwonym pasem, szachownice z obwódką na skrzydłach i stateczniku, numer 042; w dźwięku gwizd turbiny;
  - **PZL P.11c** (`p11c.js`) – przedwojenny myśliwiec: skrzydło mewie (przy kadłubie pocienione i wznoszące się stromo) z zastrzałami „V”, silnik Mercury w pierścieniu Townenda z cylindrami, drewniane śmigło, otwarta kabina (wiatrochron, celownik, obszyta krawędź), stałe podwozie i płoza; akrobacyjny, do ~375 km/h; khaki z błękitnym spodem, szachownice na skrzydłach i sterze kierunku, numer 8.63; tylko światła pozycyjne – bez stroboskopów, błyskacza i reflektorów (`userData.noLights`, panel pokazuje „BEZ REFLEKTORÓW”);
  - wspólne części (`parts.js`): kadłub z przeszkloną kabiną i ramami, śmigło z tarczą rozmycia, klosze świateł, stery na zawiasach, opony, znaki rejestracyjne, pilot; kabina (`cockpit.js`) dopasowywana do samolotu (położenie, szerokość, skala tablicy, miejsce pilota, drugi fotel); światła przepinane między modelami bez rekompilacji shaderów;
  - każdy samolot ma własny model lotu (`flight.js`: prędkości, przechył, wznoszenie, przyspieszenie, wysokość podwozia, obroty śmigła); wybór zapamiętywany w planie lotu i w zapisach.
- **Samolot** (`src/plane/`): PZL M-18 Dromader z geometrii liczonej w kodzie, w wymiarach oryginału:
  - kadłub z przekrojów superelips (`geo.js`): osłona silnika z widocznymi cylindrami gwiazdy i klapkami chłodzenia, garb zbiornika z wlewem, przeszklona kabina, zwężający się ogon; wierzchołki kadłuba leżą dokładnie na krawędziach szyb, więc ramy i okna mają czyste brzegi;
  - dolnopłat NACA 4415 ze wzniosem zewnętrznych części i zbieżnymi końcówkami, klapy, ruchome lotki, ster wysokości i kierunku (wychylają się ze sterowaniem), zastrzały usterzenia;
  - opony, goleń i kółko ogonowe, belka oprysku z dyszami, wiatraczek pompy, nożyce do przewodów przed szybą, linka do statecznika, antena, rurka Pitota, znaki rejestracyjne SP-DRB na burtach i pod skrzydłem, pilot w kabinie;
  - skręcone łopaty śmigła z żółtymi końcówkami; przy wysokich obrotach tarcza rozmycia ze smugami, oświetlona jak otoczenie;
  - lakier PBR z lakierem bezbarwnym, odbiciem nieba i ziemi z atmosfery, liniami blach, matowym pasem przeciwodblaskowym, okopceniem za wydechem i pasem do chodzenia na skrzydle (`materials.js`); szyby przezroczyste z Fresnelem;
- **Księżyc i gwiazdy** (`src/moon.js`, `atmosphere/gpu.js`):
  - położenie Księżyca z uproszczonej teorii Meeusa (~0,3°) dla daty i godziny, faza z kąta Słońce–Księżyc; tarcza oświetlona od strony słońca, z morzami i światłem popielatym;
  - drugie niebo z atmosfery liczone dla Księżyca: aureola wokół niego i ciemnoniebieska noc;
  - gwiazdy: dwie warstwy losowego katalogu na sześcianie (kilka tysięcy, różne jasności i barwy), migoczące przy horyzoncie, i Droga Mleczna z pyłowymi pasami; niebo obraca się z czasem gwiazdowym dla szerokości regionu;
  - nocą główne światło sceny (oświetlenie, cienie, chmury, odblaski na wodzie) przechodzi płynnie ze Słońca na Księżyc; jego światło jest filmowo wzmocnione (~1/200 słońca zamiast 1/400 000) i chłodne;
  - ekspozycja nocą rośnie do 6, a lampy samolotu i podświetlenie przyrządów są wtedy przyciemniane;
  - suwak **Data** zmienia dzień roku (pory roku i fazy Księżyca); godzina obejmuje całą dobę. Domyślnie 29 czerwca 2026 – pełnia.
- **Światła osad nocą** (`src/citylights.js`):
  - latarnie co ~34 m na przemian po obu stronach ulic (drogi od głównych po osiedlowe) tam, gdzie wokół stoją domy – ok. 24 tys. w regionie; sodowe (pomarańczowe) i LED (białe);
  - poświata każdej latarni (jeden sprite z instancjami, z daleka nie mniejszy niż kilka pikseli – osady widać jako łańcuchy świateł na horyzoncie) i plamy światła wypalone do tekstury regionu, doliczane przez teren, drogi, tory, budynki, drzewa i słupy;
  - okna domów i bloków zapalone losowo (na okno), w odsetku zależnym od godziny: najwięcej wieczorem, mało nad ranem; ciepłe, czasem chłodne (telewizor); budynki gospodarcze ciemne;
  - latarnie zapalają się o zmierzchu (słońce ok. 2° nad horyzontem), okna wcześniej.
- **Światła** (`lights.js`): pozycyjne czerwone, zielone i białe na ogonie (każde widoczne tylko w swoim sektorze), stroboskopy na końcówkach (podwójny błysk), czerwony błyskacz na stateczniku, reflektory w krawędzi natarcia i żar z wydechów. Każde ma świecący klosz, poświatę, która z daleka nie maleje poniżej kilku pikseli, i lampę punktową oświetlającą samolot. Reflektory oświetlają też teren, drzewa, domy, drogi, tory i rzeki.
- **Kabina** (`cockpit.js`, `cockpitcam.js`):
  - tablica z przyrządami rysowanymi na canvasie: prędkościomierz z łukami zakresów, sztuczny horyzont liczony w shaderze, wysokościomierz z dwiema wskazówkami, zakrętomierz, żyrobusola, wariometr, zegar z godziną gry, przyrządy silnika i paliwo;
  - lampki ostrzegawcze (m.in. migające przeciągnięcie, błyski stroboskopu i błyskacza), przełączniki, radio z wyświetlaczem, listwa LED na osłonie przeciwodblaskowej, kompas;
  - drążek i przepustnica ruszają się ze sterowaniem; do tego fotel z pasami, kratownica, podłoga i ściany kabiny;
  - nocą tarcze świecą ciepłym podświetleniem, a wnętrze rozjaśnia przygaszona lampka;
  - oko pilota jest związane z samolotem (bez smużenia TAA); głowa ugina się pod przeciążeniem, zagląda w zakręt i drży z silnikiem;
  - słońce o kolorze i natężeniu po przejściu przez atmosferę do wysokości samolotu, światło nieba odczytywane z GPU, cień własny.
- **Cień samolotu na ziemi:** sylwetka widziana od słońca, rozmywana z wysokością jak półcień od tarczy słońca (0,53°), więc wysoko zostaje blada plama.
- **Model lotu** (arcade, `flight.js`):
  - zakręt skoordynowany z przechyłu (ω = g·tg φ / v);
  - wznoszenie kosztuje prędkość, a nurkowanie ją daje;
  - przeciągnięcie poniżej ~110 km/h, z którego samolot wychodzi po nabraniu prędkości;
  - łagodne przyziemienie albo kraksa.
- **Kamera pościgowa:** za samolotem i nad nim, z opóźnieniem w zakrętach, patrzy trochę przed nos.
- **Obraz końcowy:**
  - scena w HDR z wektorami ruchu (MRT), bufor głębi odwrócony (precyzja od 2 m do 1200 km);
  - chmury liczone po scenie: znają jej głębię, więc nie zasłaniają samolotu;
  - TRAA: drgająca kamera, historia klatek i wektory ruchu. Wysokości terenu są w wierzchołkach (liczone na CPU), żeby wektory ruchu były poprawne;
  - tilt-shift: ostry pas na samolocie, rozmycie dyskiem ku górze i dołowi kadru, silniejsze, gdy kamera jest blisko;
  - gradacja kolorów i tone mapping ACES.

  Uwaga do TSL na Direct3D: `smoothstep(a, b, x)` z a > b nie daje opadającego zbocza (w HLSL to zachowanie nieokreślone), dlatego wszędzie jest `smoothstep(b, a, x).oneMinus()`.
- **Za krawędzią regionu** ciągnie się świat zastępczy z tym samym materiałem (lasy i pola z szumu), wygaszany w mgle.

Pomiar w przeglądarce: `await __lot.bench(30)` zwraca czas klatki w ms, także w ukrytej karcie. W 1416×1274 na AMD RDNA2 cała klatka (teren, woda, las 3D, drogi, budynki, kolej, mapa cieni, chmury, samolot, TAA, tilt-shift) zajmuje około 8–9 ms.

## Generator regionów w grze

Menu → **Regiony i generator map** buduje nowy region bez narzędzi i bez serwera – wszystko dzieje się w przeglądarce:

1. Środek: wyszukiwarka miejscowości (Nominatim) albo gotowe propozycje; bok 20–60 km; rzeźba standardowa (siatka
   2048², kafle Terrarium z12, ok. 25 m) albo szczegółowa (4096², z13 – na góry); budynki wszystkie, bez małych (< 60 m²)
   albo żadne.
2. Szacunek z 9 kafli rozłożonych po regionie: liczba kafli, rozmiar pobierania, budynki i drogi, obciążenie gry
   (budynki to większość trójkątów sceny: Bory – 73 tys., centrum Katowic 20 × 20 km – 180 tys.).
3. Worker (`src/gen/worker.js`) pobiera kafle wektorowe [OpenFreeMap](https://openfreemap.org) (schemat OpenMapTiles,
   z14, ok. 1,5 km) i kafle wysokości, każdy od razu zapisuje w IndexedDB (`lot-gen`, magazyn `tiles`, klucz
   `źródło/z/x/y`), dekoduje (`src/gen/mvt.js`), przycina do kwadratu kafla i przelicza na układ gry
   (`src/gen/convert.js`): drogi, tory, perony, stacje, budynki (rodzaj z pola i wysokości), cieki, a wielokąty pokrycia
   rastruje do mapy klas z ważnością (woda > mokradła > las > zabudowa > pola > łąki; reszta – pola).
4. Dalej jak przy wypiekaniu: siatka wysokości, wyrównanie wody, odległość od brzegu (`src/gen/terrain.js`, wspólne z
   `tools/bake-region.js`). Region trafia do magazynu `regions` jako te same pliki `.gz` co w `data/regions/`.

Region wygenerowany ma identyfikator `gen-…`; `src/region.js` czyta go z IndexedDB zamiast z serwera. Wybór regionu
jest zapamiętany (`lot-region`), zmiana przeładowuje stronę. Zapisy lotów są osobne dla każdego regionu. Kafle zostają
w magazynie, więc kolejne regiony w tej okolicy powstają szybciej – to też podstawa późniejszego strumieniowania
większych obszarów (np. całe województwo) kafel po kaflu.

Czego kafle OpenMapTiles nie mają: linii energetycznych, szpalerów drzew, przejazdów kolejowych, kształtów dachów
i rodzajów budynków – w regionach generowanych ich nie ma albo są wyprowadzane z wysokości i pola.

## Otwarty świat (beta)

Osobny tryb obok regionów: zamiast wycinka wczytanego w całości – kafle doczytywane w locie wokół samolotu, z tych
samych źródeł co generator (OpenFreeMap z14, Terrarium z12) i z tą samą pamięcią kafli w IndexedDB. Wejście: menu
główne → **Otwarty świat · cała Polska · beta** – gotowe miejsca startu (`WORLD_PRESETS` w `src/world/start.js`),
wyszukiwarka miejscowości i ostatni start; przy każdym miejscu jakość mapy (`qualityAt`: pełna na wypieczonych kaflach
własnych z listy z14 w `data/tiles/lot/tiles.json`, podstawowa poza nimi). Dalej też: generator → **Otwarty świat
stąd** i lista regionów („Otwarty świat · …”). W locie – komunikaty przy granicy pełnej jakości i gdy kafle nie
dochodzą (brak sieci). Regiony działają jak dotąd i zostają trybem głównym.

- **Kafel** (`src/world/chunkdata.js`) = kafel Web Mercator z14 (~1,5 km): siatka wysokości 65² z marginesem (normalne
  ze wspólnych punktów – bez szwów światła), raster pokrycia 128² (~12 m), obiekty z `convertTile` w metrach świata.
- **Wątki** (`src/world/chunkworker.js`, 2–4): pobranie lub odczyt z pamięci, dekodowanie PNG wysokości (bufor 48
  kafli z12), złożenie kafla; bufory przekazywane bez kopiowania. Ok. 160 ms na kafel z pamięci, ~250 ms z sieci.
- **Doczytywanie** (`src/world/streamer.js`): teren w promieniu 9 km (~150 kafli), drogi i budynki w 4 km, najbliższe
  najpierw, zwalnianie za 1,25 × promienia, histereza obiektów; wysokość na trójkątach siatki kafla (`gridHeightAt`).
- **Widok** (`src/world/chunkview.js`): teren kafli tym samym shaderem gruntu co regiony (`shadeGround` w
  `src/terrain.js` – pola w pasach z miedzami, bory, zabudowa, woda z odbiciem nieba), pokrycie w jednej teksturze
  warstwowej (256 warstw), drogi (`ribbon` z `src/roads.js`) i budynki (`createBuildings`) budowane po jednym kaflu na
  klatkę, ze wspólnymi materiałami; pod wszystkim daleka „podłoga” ze światem zastępczym. W tym samym kroku rzeki
  i strugi, tory, mosty i perony (`createRivers`, `createRails`, `createBridges` z parametrem `shared`).
- **Drzewa 3D** (`src/world/window.js`): las regionów (`createForest`) czyta zamiast tekstur regionu „okno gruntu”
  2,8 × 2,8 km wokół kamery (512², połowa precyzji, adresowane w kółko): R – gęstość lasu z rastra pokrycia, G –
  wysokość na trójkątach siatki kafla, B – maska dróg, torów i cieków z wątku kafli (256² na kafel). Przesunięcie
  okna przepisuje tylko pasy, które do niego weszły (~1 ms), nowy kafel – swój prostokąt. Teren kafli liczy brzeg
  lasu tym samym wzorem (`forestCover`) – korony z daleka i drzewa z bliska się pokrywają.
- **Ruch** (`src/world/networker.js`): co ~2 km lotu osobny wątek czyta kafle z pamięci, buduje graf dróg (5 km)
  i torów ze stacjami (9 km) i oddaje je spakowane w tablicach (`packNetwork` / `unpackNetwork` w
  `src/traffic/graph.js` – krawędzie i węzły jako leniwe widoki). Samochody i pociągi są przepinane na nowy graf
  (`TrafficSim.rebind`, `TrainSim.rebind`, rzut na najbliższą krawędź w kierunku jazdy – `projectToGraph`), więc nie
  znikają; piesi dostają drogi i perony z kafli do 3 km (`PeopleSim.setRoads`). Podmiana w wątku głównym ~20–30 ms.
- Pomiar: przelot 15 km w 10 s (~20 × szybciej niż samolot) – doczytywanie nadąża, klatka: mediana 13,5 ms, p95 21 ms;
  z drzewami i ruchem nad Katowicami ~75 kl./s.

- **Mapy** (`src/world/maptiles.js`): płytka mapy 192² na kafel (pokrycie w barwach mapy, cieniowanie rzeźby,
  cieki, drogi, tory), rysowana po jednej na klatkę i pamiętana (do 400 – przeleciany obszar zostaje na mapie).
  Minimapa i duża mapa rysują mapę przez `drawOn(ctx, x0, z0, pxPerM, r)` – `regionBase` (jedno płótno regionu)
  albo `WorldMap` (płytki). Nazwy miejscowości z kafli (warstwa „place”) trafiają do map, opisu położenia
  i podpisów w krajobrazie.
- **Noc** (`src/world/lights.js`, ten sam interfejs co `src/citylights.js`): latarnie liczone dla kafla (ulice
  klas 1–4 w zabudowie), poświaty wszystkich wczytanych kafli w jednym spricie (bufor przebudowywany najwyżej
  2 razy na sekundę), plamy światła na ziemi w oknie 2,8 km wokół kamery (jak okno gruntu).
- Podmiana sieci ruchu rozłożona na klatki: samochody (po 300 na krok – reszta jedzie po starym grafie), pociągi,
  piesi; ~5 ms na klatkę.

- **Lasy górskie** (`forestStand(xz, h)` w `src/gfx/stand.js`): z wysokością n.p.m. 350–650 m siatka oddziałów
  rozmyta szumem w nieregularne płaty, bez duktów, mniej zrębów i młodników, buk na niższych stokach, świerk wyżej.
- **Bez granic** (`src/geo.js`, `world.rebase`): środek otwartego świata ma pole `merc: { k }` – `lonLatToLocal`
  i `localToLonLat` liczą wtedy Web Mercator o skali k = cos(szerokości startu). Mercator jest jeden dla całej Ziemi,
  więc nowy początek układu to czyste przesunięcie (kafle policzone przed i po zgadzają się co do milimetra;
  skala rośnie ~1% na 100 km na północ lub południe od startu). Gdy samolot jest dalej niż 20 km od początku,
  początek przesuwa się pod niego o wielokrotność 14 080 m (5 × bok okien gruntu i świateł – ich piksele zostają
  ważne; wielokrotność odstępu drzew 5 m i komórek siatek ruchu 256 / 640 m). Przesuwane w miejscu: pozycje siatek
  kafli, ramy i obiekty kafli (`shiftOsm`), grafy i siatki ruchu (`shiftGraph`, `shiftGrid`), mapa, latarnie, ptaki,
  samolot, kamery; chmury dostają przesunięcie pogody i poprawioną poprzednią macierz kamery (akumulacja bez
  skoku). Wzory proceduralne w shaderach liczą się od `xz + worldOffset` (`src/gfx/ground.js`). ~20 ms raz na
  kilkanaście km lotu. Zapis lotu pamięta początek układu i przelicza położenie przy wczytaniu.
- **Daleki teren** (`FarView`, `NearMask` w `src/world/chunkview.js`): drugi `WorldStreamer` z kaflami z11 do 50 km
  (te same wątki kafli: rzeźba z Terrarium z11, pokrycie z warstw water / landcover / landuse mapy z11), siatka 65²
  (~195 m) tym samym shaderem gruntu. Pod wczytanymi kaflami z14 piksele dalekiego terenu są odrzucane (maska 64²
  numerów kafli adresowana w kółko – kafle w Mercatorze tworzą równą siatkę), a na styku szczeliny zasłaniają
  „fartuchy” kafli z14 (pas opuszczony o 40 m). Za 50 km – płaska podłoga.

- **Miejsca startu**: miasta i miasteczka z mapy (warstwa „place” kafli z14 i z11) do 40 km od startu, najwyżej 10,
  trafiają do planu lotu; `world.ready` trzyma punkt doczytywania przy nowym miejscu do końca wczytywania.
- **Doczytywanie z wyprzedzeniem**: streamer dostaje prędkość samolotu (z ruchu punktu doczytywania) i trzyma kafle
  także wokół punktu 25 s lotu do przodu (do 3 km); kafle z przodu w kolejce jakby o 40% bliżej.
- **Pamięć kafli** (`src/gen/store.js`): magazyn `tileinfo` z czasem ostatniego użycia i rozmiarem kafla (zapis
  najwyżej co 6 h na kafel), `trimTiles(max)` usuwa najdawniej używane do 90% limitu; otwarty świat przycina co
  10 minut do 1 GB (najwyżej 30% przydziału przeglądarki).

- **Własne kafle** (`npm run bake:tiles -- <obszar…|polska>`, `tools/bake-tiles.js`), np.
  `npm run bake:tiles -- malopolskie opolskie`: obszary to województwa Geofabrik (`polska` – wszystkie 16). W
  `tools/.cache/tiles-src/` musi być `planetiler.jar` (github.com/onthegomap/planetiler); wyciąg OSM
  `<wyciąg>-latest.osm.pbf` (domyślnie `--osm=poland` – cała Polska, ok. 2 GB) i pliki `.poly` wyciągu i obszarów
  narzędzie pobiera z Geofabrik samo, jeśli ich nie ma (`--no-download` – bez pobierania). Planetiler ze schematem
  `tools/tiles/lot-schema.yml` zapisuje kafle wyciągu raz do `tools/.cache/tiles-src/vector-<wyciąg>/` (ponownie
  dopiero po nowszym wyciągu albo z `--rebuild-vector`; pamięć Javy – `PLANETILER_XMX`, domyślnie 6g), a do
  `data/tiles/lot/{z}/{x}/{y}.pbf` trafiają tylko kafle obszarów (warstwy: roads, rails, platforms, buildings,
  waterways, water, power, tree_rows, stations, crossings – z14; places – od z11) z surowymi znacznikami OSM; inne
  obszary zostają nietknięte. Narzędzie dokłada rastry pokrycia z ESA WorldCover (zapytania Range do COG,
  `tools/lib/cog.js`) dla z14 i z11 (`cover/{z}/{x}/{y}.bin.gz`) i opis `tiles.json` (`src/gen/lotmanifest.js`,
  wersja 4): obszary z czasem wypieczenia i kaflami z14 zapisanymi maskami 64-bitowymi po kaflach z11 (Śląskie – 5 kB
  zamiast 64 kB listy). Obszar bierze kafle z14, które go dotykają (`tilesInPoly` w `tools/lib/poly.js`) i leżą
  w całości wewnątrz wyciągu – kafle przecięte granicą województw mają pełne dane z obu stron, więc między
  województwami nie ma pasa OpenFreeMap; kafel należy do obszaru wypieczonego ostatnio. Przy granicy Polski (poza
  wyciągiem) zostaje OpenFreeMap. `--osm=<obszar>` – jak wcześniej: wyciąg samego województwa, tylko kafle w całości
  wewnątrz niego. Znacznik wypieczenia obszaru trafia do kluczy pamięci kafli – po ponownym wypieczeniu jednego
  województwa gra pobiera na nowo tylko jego kafle.
  W grze (`src/world/chunkworker.js`): kafel z listy – własne dane (`convertLotTile` w `src/gen/lottiles.js`,
  znaczniki → klasy tą samą logiką co narzędzia regionów: `src/gen/osmtags.js`), poza listą – OpenFreeMap.
  Do tego rastry wysokości `height/14/{x}/{y}.bin.gz` (131², Int16 w decymetrach – wierzchołki siatki 129² i
  margines) i `height/11/…` dla dalekiego terenu (67²; poza Polską znacznik braku danych – gra bierze tam Terrarium) z numerycznego modelu terenu GUGiK (usługa WCS, zapytanie w EPSG:3857 o obszar kafla tak, by środki
  pikseli wypadły w wierzchołkach siatki; ~1,5 s na kafel, 6 naraz – Śląskie ~25 minut, przerwane wypiekanie
  dokańcza tylko brakujące). Pokrycie 256²: drzewa z WorldCover w zabudowie OSM (warstwy landuse i wood) – zabudowa.
  Hosting kafli (wersja przeglądarkowa) – do ustalenia; teraz serwer gry podaje je z dysku.
- **Pomiar wydajności**: `http://localhost:4190/?prof` – znaczniki czasu GPU (`await __lot.gpuTime(20)`); koszt
  warstwy najlepiej mierzyć na przemian z nią i bez niej, z wstrzymaną pętlą gry (`__lot.renderer.setAnimationLoop(null)`,
  potem `__lot.post.render()` i `device.queue.onSubmittedWorkDone()`), bo pojedyncze pomiary wahają się o kilka ms.
- **Obiekty w wątkach**: przy wejściu kafla w pierścień obiektów wątek kafli liczy geometrię budynków
  (`buildBuildingTiles`, `src/buildgeo.js` – bez Three.js poza triangulacją z `three.core.js`) i dróg (`ribbon`,
  `src/gfx/ribbon.js`) z zapamiętanych danych kafla i oddaje tablice bez kopiowania; wątek główny tworzy z nich
  siatki; rzeki, tory, mosty i perony, aleje i linie energetyczne – też w wątku (`src/objgeo.js`, wspólne z regionami),
  razem z sferami otaczającymi budynków – w wątku głównym ~1 ms na kafel. Kafle i ich obiekty mają sfery otaczające
  (z zapasem na krzywiznę Ziemi) – odrzucanie poza kadrem i poza obszarem mapy cieni (klatka była ograniczona
  procesorem: wysyłanie obiektów do karty).

## Struktura

```
index.html, style.css      strona, panel, ekran wczytywania i okno „brak WebGPU”
src/main.js                start, pętla, panel, automatyczna ekspozycja
src/region.js              wczytanie regionu → tekstury
src/terrain.js             siatka terenu i materiał TSL (shadeGround – wspólny z otwartym światem)
src/world/                 otwarty świat: dane kafla, wątki kafli i sieci ruchu, doczytywanie, widok kafli, okno gruntu, tryb w grze
src/atmosphere/model.js    stałe atmosfery, przepuszczalność na CPU
src/atmosphere/gpu.js      tablice LUT, niebo, perspektywa powietrzna (TSL)
src/post.js                przebieg końcowy: niebo, mgiełka, chmury, gradacja
src/clouds/clouds.js       chmury: gęstość, marsz promienia, akumulacja czasowa, cień na ziemi
src/clouds/noise3d.js      szumy 3D i mapa pogody (CPU)
src/camera.js              kamera swobodna
src/moon.js                Księżyc, czas gwiazdowy, sfera niebieska
src/citylights.js          latarnie i okna nocą
src/traffic/graph.js       ruch: graf dróg, łączenie skrzyżowań
src/traffic/sim.js         ruch: symulacja pojazdów wokół kamery
src/traffic/render.js      ruch: pojazdy i ich światła na GPU
src/traffic/trains.js      kolej: graf torów, pociągi, postoje
src/traffic/trainview.js   kolej: wagony i światła na GPU
src/fauna/birds.js         ptaki: gatunki, stada, płoszenie, zderzenia
src/fauna/birdmodels.js    ptaki: bryły gatunków z parametrów
src/fauna/birdview.js      ptaki na GPU: stawy skrzydeł, przechył, wektory ruchu
src/fauna/birddots.js      odległe ptaki jako kropki (nakładka po wygładzaniu)
src/fauna/people.js        piesi: chodniki, ścieżki, perony
src/fauna/peopleview.js    piesi na GPU z krokiem i parasolami
src/weather/weather.js     pogoda: rodzaje, wiatr, turbulencja, błyskawice
src/weather/precip.js      deszcz, śnieg i błyskawice na GPU
src/audio/audio.js         dźwięk: synteza Web Audio (silnik, śmigło, wiatr, zdarzenia, menu)
src/audio/mix.js           poziomy i częstotliwości dźwięku
src/ui/menu.js             menu, pauza, plan lotu, zapisy, ustawienia
src/ui/menu.css            styl menu, ekranu startowego i wczytywania
src/ui/loading.js          ekrany wczytywania (tło 2D, karta, postęp)
src/gen/                   generator regionów: worker, klient, dekoder MVT, kafle, konwersja, IndexedDB
src/ui/bigmap.js           duża mapa i wybór celu lotu
src/ui/minimap.js          minimapa: mapa bazowa regionu, wycinek, skale
src/ui/nav.js              nawigacja: współrzędne, wiatr względny, granica mapy, pasek kursu
src/ui/places.js           miejsca startu, pory, pogoda, opis położenia, pamięć przeglądarki
src/plane/model.js         model Dromadera
src/plane/wilga.js         model PZL-104 Wilga 35
src/plane/extra.js         model Extra 330LX
src/plane/parts.js         części wspólne modeli
src/plane/aircraft.js      rejestr samolotów do wyboru
src/plane/geo.js           bryły: loft kadłuba, panele o profilu, rury
src/plane/materials.js     lakier, szyby, wnętrze
src/plane/cockpit.js       kabina i przyrządy
src/plane/cockpitcam.js    widok z kabiny
src/plane/lights.js        światła samolotu i reflektory na terenie
src/plane/flight.js        arcade'owy model lotu
src/plane/chase.js         kamera pościgowa
src/plane/plane.js         samolot w scenie: światła, cień własny, cień na ziemi
src/gfx/tiltshift.js       efekt miniatury
src/forest.js              drzewa 3D rozstawiane na GPU
src/gfx/stand.js           drzewostany (wspólne dla tekstury i drzew 3D)
src/gfx/palette.js         kolory terenu i drzew
src/gfx/waves.js           mapa fal jezior
src/roads.js               drogi i dukty, maska dróg
src/buildings.js           budynki 3D
src/rails.js               tory
src/bridges.js             mosty, wiadukty, perony
src/rivers.js              rzeki i strugi
src/details.js             aleje, linie energetyczne
src/shadows.js             mapa cieni świata
src/gfx/lit.js             materiał i bryły dla prostych obiektów
tools/bake-osm.js          wypiekanie OSM (+ tools/lib/osm.js)
src/sun.js, src/geo.js     położenie słońca, układ współrzędnych
src/gfx/noise.js           szumy i komórki Woronoja w TSL
tools/bake-region.js       wypiekanie regionu (+ tools/lib: PNG, COG, obróbka siatek)
tools/vendor.js            kopiuje Three.js z node_modules do vendor/three
tools/web.js               wersja przeglądarkowa (web/lot/ i ZIP; + tools/lib/zip.js)
tools/dist.js              pakowanie aplikacji desktopowej (electron-builder)
tools/make-icon.js         ikony aplikacji i strony
electron/main.cjs          aplikacja desktopowa: okno, protokół app://, samosprawdzenie
electron/preload.cjs       window.desktop dla strony
electron/assets.cjs        ścieżki i typy plików protokołu app://
```

## Licencje danych

- Wysokości: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), z różnych otwartych źródeł (m.in. SRTM, EU-DEM).
- Pokrycie terenu: © ESA WorldCover project 2021 / Copernicus Sentinel data 2021, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Drogi, budynki, tory i inne obiekty: © współtwórcy [OpenStreetMap](https://www.openstreetmap.org/copyright), licencja ODbL.
- Regiony generowane: kafle wektorowe [OpenFreeMap](https://openfreemap.org), © [OpenMapTiles](https://openmaptiles.org); wyszukiwanie miejscowości: [Nominatim](https://nominatim.org) (OSM).
- Three.js: MIT (`vendor/three/LICENSE`).
