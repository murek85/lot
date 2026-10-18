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
  - plan lotu: miejsce startu (Tuchola, Jezioro Charzykowskie, Chojnice, Rytel, Czersk, Człuchów), pora dnia, pora roku, pogoda i widok – wybór od razu zmienia scenę w tle;
  - pauza (Esc): Wznów, Pogoda i pora dnia, Zapisz / Wczytaj (5 slotów + autozapis co 30 s i przy wyjściu do menu), Ustawienia, Sterowanie, Menu główne, z raportem lotu (położenie „2 km na płd.-wsch. od Tucholi”, prędkość, wysokość, kurs, czas);
  - kraksa jako okno z „Leć ponownie” (Enter), „Wczytaj lot”, „Menu główne”;
  - ustawienia w zakładkach Obraz / Sterowanie / Interfejs (miniatura, ekspozycja, rozdzielczość, przewyższenie, odwrócona oś, czułość myszy, pole widzenia w kabinie, panel lotu, licznik klatek, ograniczenie animacji, panel deweloperski) – zapamiętywane w `localStorage` (klucze `lot-…`);
  - ekrany wczytywania jak w Maszyniście (`src/ui/loading.js`): przy starcie lotu, wczytaniu zapisu i ponownym starcie – pełny ekran z animowanym tłem 2D (przelot nad polami, lasami, rzeką i drogami, sylwetka samolotu z cieniem i światłami, chmury; nocą światła osad, samolot zwalnia w miarę postępu) i kartą: linia nagłówkowa (rodzaj wczytywania, rejestracja, samolot), miejsce, opis lotu, pasek z etapem i procentem, wskazówka; praca rozłożona na klatki, na końcu rozgrzewka za kartą (kompilacja shaderów, chmury, wygładzanie), więc lot zaczyna się bez przycięć;
  - mała karta nad menu przy zapisie lotu („Lot zapisany · slot 3”) i przy pierwszym wyborze samolotu w planie lotu (budowa modelu i kompilacja materiałów); gdy przeglądarka wstrzyma klatki (okno w tle), kroki kończą się na zegarze;
  - Esc cofa o poziom, Enter startuje; przyciski z podświetleniem krawędzi i przebiegiem światła, szklane okna z narożnikami i linią skanu; `prefers-reduced-motion` wyłącza animacje.
- **Samoloty do wyboru** (`src/plane/aircraft.js`, wybór w planie lotu – sekcja „Samolot”):
  - **PZL M-18 Dromader** – rolniczy dolnopłat (opis niżej);
  - **PZL-104 Wilga 35** (`wilga.js`) – górnopłat STOL: przeszklona kabina z oknami aż do kolan (widok w dół przez drzwi), skrzydło ze stałymi slotami, silnik gwiazdowy z dwułopatowym śmigłem, wysokie podwozie na wahaczach; lata wolno (przeciąga ~60 km/h), stromo się wznosi; malowanie aeroklubowe biało-czerwone, SP-WGA, dwa fotele;
  - **Extra 330LX** (`extra.js`) – akrobacyjny: kroplowa owiewka, zbieżne skrzydło o profilu symetrycznym z lotkami na prawie całej rozpiętości, trójłopatowe śmigło, owiewki kół; szybki (do ~345 km/h, Vne ~407 km/h) i zwinny – lotki obracają go bez ograniczeń (~300°/s), więc można robić beczki i lecieć na plecach (ster wysokości działa wtedy odwrotnie względem ziemi); puszczony blisko poziomu sam się wyrównuje; biel z czerwono-granatowym pasem i promieniami słońca na skrzydłach, SP-AKR;
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

## Struktura

```
index.html, style.css      strona, panel, ekran wczytywania i okno „brak WebGPU”
src/main.js                start, pętla, panel, automatyczna ekspozycja
src/region.js              wczytanie regionu → tekstury
src/terrain.js             siatka terenu i materiał TSL
src/atmosphere/model.js    stałe atmosfery, przepuszczalność na CPU
src/atmosphere/gpu.js      tablice LUT, niebo, perspektywa powietrzna (TSL)
src/post.js                przebieg końcowy: niebo, mgiełka, chmury, gradacja
src/clouds/clouds.js       chmury: gęstość, marsz promienia, akumulacja czasowa, cień na ziemi
src/clouds/noise3d.js      szumy 3D i mapa pogody (CPU)
src/camera.js              kamera swobodna
src/moon.js                Księżyc, czas gwiazdowy, sfera niebieska
src/citylights.js          latarnie i okna nocą
src/weather/weather.js     pogoda: rodzaje, wiatr, turbulencja, błyskawice
src/weather/precip.js      deszcz, śnieg i błyskawice na GPU
src/audio/audio.js         dźwięk: synteza Web Audio (silnik, śmigło, wiatr, zdarzenia, menu)
src/audio/mix.js           poziomy i częstotliwości dźwięku
src/ui/menu.js             menu, pauza, plan lotu, zapisy, ustawienia
src/ui/menu.css            styl menu, ekranu startowego i wczytywania
src/ui/loading.js          ekrany wczytywania (tło 2D, karta, postęp)
src/gen/                   generator regionów: worker, klient, dekoder MVT, kafle, konwersja, IndexedDB
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
