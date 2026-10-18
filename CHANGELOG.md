# Dziennik zmian – Lot nad Polską

Historia do 0.7 odtworzona z przebiegu prac nad prototypem (sprzed pierwszego commitu). Numery 0.1–0.6 nadane
wstecz kolejnym etapom; od 0.7 numer jest pokazywany w grze. Kolejność wewnątrz wersji – od najważniejszych zmian.

## 0.17 – nawigacja w locie

- Pasek kursu (kompas) u góry ekranu i panel położenia: miejscowość z dzielnicą, odległość i kierunek od ważnej
  miejscowości, współrzędne, wiatr względem samolotu, ostrzeżenie o granicy mapy z kursem powrotu.
- Nazwy miejscowości regionów (do 900) z kafli OpenFreeMap – `npm run bake:labels`; generator zapisuje je od razu.

## 0.16 – upływ czasu

- Czas w locie płynie: zatrzymany, rzeczywisty, ×10, ×60; wybór w planie lotu i na pauzie, klawisze T (stop / start)
  i Shift+T (przyspieszenie); przejście przez północ do następnego dnia.
- Zegar z datą i tempem w panelu lotu.

## 0.15 – piesi

- **Piesi** na chodnikach, deptakach i ścieżkach w zabudowie, czekający na peronach – widoczni z niska (poniżej
  ~350 m), z krokiem, różnymi ubraniami i wzrostem; w deszczu parasole.
- Natężenie zależne od godziny i pogody; gwar w dźwięku; przełącznik „Piesi” w ustawieniach.
- Sieć ścieżek budowana na bieżąco w okolicy kamery (bez wydłużania wczytywania).

## 0.14 – ptaki

- **Ptaki** zależne od miejsca, pory dnia i roku oraz pogody: stada szpaków (o zmierzchu wielkie, falujące),
  bociany, krążące myszołowy, mewy nad wodą, wrony nad miastami.
- Stada płoszone przez przelatujący samolot, zderzenie z ptakiem.
- Machanie i szybowanie, głosy ptaków, trzepot stada; przełącznik „Ptaki” w ustawieniach.

## 0.13 – kolej

- **Pociągi** na torach regionu: regionalne zespoły elektryczne, Intercity, towarowe z węglarkami i cysternami,
  wąskotorowe; postoje na stacjach i przystankach, zmiana kierunku na końcu toru, tylko łagodne rozjazdy.
- Wagony wyginające się na łukach i pochylające na wzniesieniach, nocą oświetlone okna, reflektory i światła końca.
- Dudnienie, stukot i sygnał pociągu; przełącznik „Ruch kolejowy” w ustawieniach.
- Poprawka siatki przestrzennej dróg i torów: długie proste odcinki nie przeskakują komórek.

## 0.12 – ruch uliczny

- **Samochody, dostawczaki, ciężarówki i autobusy** na drogach wokół samolotu: prędkość i gęstość zależne od klasy
  drogi, pory dnia (szczyty), pogody; odstępy, skrzyżowania, ruch prawostronny, jednokierunkowe, mosty.
- Nocą reflektory i czerwone światła tylne – strumienie świateł na głównych drogach.
- Sieć dróg z danych regionu z łączeniem skrzyżowań zgubionych w kaflach wektorowych; kierunek jednokierunkowy
  w danych dróg (regiony wbudowane wypieczone ponownie).
- Szum ruchu w dźwięku, suwak „Ruch uliczny” w ustawieniach.

## 0.11 – kominy i chłodnie

- Kominy elektrowni, ciepłowni i kopalń, chłodnie kominowe i zbiorniki rozpoznawane z kształtu obrysu (kafle mapy
  nie mają rodzaju budynku) – bez okien, więc nocą już nie świecą jak bloki.
- Chłodnie w kształcie hiperboloidy, kominy od 100 m z biało-czerwonymi pasami, nocą migające czerwone światła
  przeszkodowe.

## 0.10 – pogoda

- **Deszcz, śnieg i burza** w planie lotu i na pauzie: krople i płatki na GPU wokół kamery (smugi pędzące na szybę
  lecącego samolotu), zasłona opadu w oddali, niska i gęsta warstwa chmur.
- **Śnieg na ziemi**: pola i korony drzew stopniowo bieleją.
- **Burza**: błyskawice z odgałęzieniami, rozświetlenie nieba i chmur, grzmot opóźniony o odległość.
- **Wiatr** do wyboru (cisza … wichura): znoszenie samolotu, porywy, turbulencja, szybsze chmury; w raporcie lotu.
- Dźwięk pogody: deszcz i bębnienie o kabinę, wiatr z porywami, grzmoty.

## 0.9 – dźwięk

- **Dźwięk syntezowany w Web Audio** (bez plików nagrań): silnik z tonem zapłonów zależnym od obrotów i od maszyny
  (gwiazdowy Dromadera i Wilgi, bokser Extry), pulsujący wydech, świst śmigła z przejściem łopat, wiatr rosnący
  z prędkością, toczenie po ziemi.
- Brzęczyk przeciągnięcia, przyziemienie (uderzenie i pisk opon zależny od opadania), kraksa i wybieg silnika.
- Inne brzmienie w kabinie i z zewnątrz (odległość kamery, tłumienie wysokich tonów), cichy silnik w menu,
  przytłumienie na pauzie.
- Dźwięki menu: wskazanie, kliknięcie, wybór, powrót, sygnał gotowości po wczytaniu.
- Ustawienia → Dźwięk (głośność ogólna, silnika, otoczenia, dźwięki menu), klawisz M – wyciszenie.

## 0.8 – generator regionów, Zabrze i Beskid Śląski

- **Nowe regiony wbudowane** (46 × 46 km, kafle OpenStreetMap, rzeźba szczegółowa): **Zabrze** – teraz domyślny
  (Gliwice, Katowice, Bytom, Ruda Śląska, Chorzów; 470 tys. budynków) i **Beskid Śląski** (Szczyrk, Bielsko-Biała,
  Wisła, Ustroń, Żywiec, Skoczów; do 1549 m n.p.m.), z odmianą nazw w opisie położenia.
- `npm run bake:gen` – wypiekanie regionów wbudowanych tym samym rdzeniem co generator w grze.
- **Generator regionów w grze** (menu → Regiony i generator map): środek z wyszukiwarki miejscowości (Nominatim) albo
  z propozycji (Katowice, Gliwice, Beskid Śląski, Jura, Częstochowa, Tatry, Kraków, Trójmiasto, Warszawa, Wrocław),
  bok 20 / 30 / 46 / 60 km, rzeźba standardowa (2048², z12) lub szczegółowa (4096², z13), budynki wszystkie / bez
  małych / bez budynków.
- **Kafle wektorowe OpenStreetMap** (OpenFreeMap, schemat OpenMapTiles, z14): drogi z mostami i nawierzchnią, tory,
  perony i stacje, budynki z wysokością, cieki, woda i pokrycie terenu (las, łąki, pola, zabudowa, mokradła)
  rastrowane do mapy pokrycia; miejsca startu z miast i wsi regionu.
- Własny dekoder MVT i przycinanie obiektów do kafli – działa w workerze, gra nie zacina się podczas generowania.
- **Kafel po kaflu w IndexedDB**: pobrane kafle zostają w przeglądarce (drugi region w tej samej okolicy i przyszłe
  strumieniowanie bez ponownego pobierania), gotowe regiony – w tym samym formacie co wypieczone, działają bez sieci.
- Szacunek przed generowaniem (kafle, pobranie, liczba budynków i dróg, obciążenie gry) z próbki 9 kafli.
- Ekran postępu z możliwością przerwania; lista regionów z przełączaniem i usuwaniem; zapisy lotów osobno dla regionu.
- Obróbka terenu (wygładzanie wody, odległość od brzegu) wspólna dla narzędzia wypiekania i generatora.

## 0.7 – menu, samoloty do wyboru, wczytywanie

- **Wersja przeglądarkowa i aplikacja desktopowa** (jak w Maszyniście i Pograniczu Galaktyki): `npm run web` składa
  pliki strony w `web/lot/` i ZIP, `npm run app` / `npm run dist` – gra w oknie Electron i instalator dla Windows;
  ikona aplikacji i strony, „Wyjdź z gry” w aplikacji. Poprawka: brak światła latarni na drzewach (błąd shadera lasu).
- **Menu w stylu Pogranicza Galaktyki i Maszynisty**: ekran startowy z logo i „Kliknij lub naciśnij dowolny klawisz”,
  menu nad żywą sceną (Dromader krąży na autopilocie, kamera go okrąża), rama z celownikami i pasem skanu.
- **Plan lotu**: samolot, miejsce startu (Tuchola, Jezioro Charzykowskie, Chojnice, Rytel, Czersk, Człuchów), pora
  dnia, pora roku, pogoda, widok na starcie – wybór od razu zmienia scenę w tle.
- **Pauza (Esc)** z raportem lotu (położenie słownie, prędkość, wysokość, kurs, czas), szybka zmiana pogody i pory.
- **Zapisy**: 5 slotów i autozapis (co 30 s i przy wyjściu do menu), „Kontynuuj lot”, okno kraksy z „Leć ponownie”.
- **Ustawienia** w zakładkach Obraz / Sterowanie / Interfejs, zapamiętywane w przeglądarce.
- **Nowe samoloty**: PZL-104 Wilga 35 (górnopłat STOL, widok w dół przez drzwi) i Extra 330LX (akrobacyjny – beczki,
  lot na plecach), każdy z własnym modelem, kabiną, światłami i modelem lotu.
- **Ekrany wczytywania jak w Maszyniście**: przy starcie lotu, wczytaniu zapisu i ponownym starcie – animowany
  przelot nad polami, karta z planem lotu, etapy i wskazówki; mała karta przy zapisie i budowie nowej maszyny.
- Wspólny pasek przewijania w barwach gry, miękkie znikanie treści na krawędziach okien.
- Poprawki: drżenie skrzydeł w menu (regulator autopilota), opisy pól wyboru w jednej linii, panel deweloperski
  ukryty domyślnie (włączany w ustawieniach, klawisz H).

## 0.6 – samolot z bliska, kabina, noc

- **Nowy model Dromadera**: kadłub z przekrojów, przeszklona kabina z ramami, silnik gwiazdowy z cylindrami, ruchome
  lotki i stery, belka oprysku, linka do statecznika, znaki SP-DRB, lakier z liniami blach i okopceniem.
- **Światła**: pozycyjne z sektorami widoczności, stroboskopy, błyskacz, reflektory oświetlające teren i osady.
- **Kabina**: działające przyrządy (sztuczny horyzont, żyrobusola, wysokościomierz, wariometr, zegar, silnik),
  lampki, listwa LED, drążek i przepustnica; widok z kabiny z rozglądaniem się (C / V).
- **Księżyc i gwiazdy**: położenie i faza z efemerydy, Droga Mleczna, niebo obracające się z czasem gwiazdowym;
  nocą krajobraz oświetla księżyc.
- **Światła osad**: latarnie wzdłuż ulic z plamami światła i okna zapalane zależnie od godziny.
- Suwak daty (pory roku i fazy księżyca), godzina z całej doby.

## 0.5 – świat z OpenStreetMap

- Dane OSM dla regionu: drogi z oznakowaniem i duktami leśnymi, budynki z dachami i oknami, kościoły z wieżami.
- **Mapa cieni świata**: budynki i drzewa rzucają cienie.
- **Kolej i mosty**: tory z podkładami i szynami, stacje i perony, mosty drogowe i kolejowe.
- Detale: aleje przydrożne, linie energetyczne ze słupami i przewodami.
- **Rzeki** jako wstęgi wody (Brda, Kiczyna), las wycięty wzdłuż koryt.

## 0.4 – woda i las

- Jeziora: fale, odbicie nieba i drzew z brzegu, odblask słońca, głębia i piana przy brzegu.
- Las z pojedynczych drzew 3D (sosny, młodniki, liściaste), rozstawianych na GPU.

## 0.3 – samolot

- PZL M-18 Dromader z prostych brył, trójłopatowe śmigło z tarczą rozmycia.
- Arcade'owy model lotu: zakręt z przechyłu, przeciągnięcie, przyziemienie i kraksa.
- Kamera pościgowa, cień samolotu na ziemi.
- Wygładzanie TAA i efekt miniatury (tilt-shift).

## 0.2 – chmury

- Wolumetryczne chmury z rozpraszaniem wielokrotnym, cieniem na ziemi i zmienną pokrywą.

## 0.1 – teren i atmosfera

- Region Bory Tucholskie (46 × 46 km) z rzeczywistej rzeźby terenu i pokrycia ESA WorldCover.
- Fizyczna atmosfera (Hillaire): niebo, słońce, perspektywa powietrzna, zmienna pora dnia.
- Pola, łąki, lasy i zabudowa w materiale terenu, kamera swobodna.
