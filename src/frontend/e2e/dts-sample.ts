/** A generated DTS race-day export for the sign-in specs: two races, four riders, no real data. Start times are relative to now. */

function local(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:00`;
}

export function sampleXml(options: { firstStartInMinutes: number; secondStartInMinutes: number } = { firstStartInMinutes: 90, secondStartInMinutes: 20 }): string {
  const now = Date.now();
  const start = (min: number) => local(new Date(now + min * 60000));
  const line = (s: string) => `${s}\n`;
  let xml = line('<?xml version="1.0" encoding="UTF-8"?>');
  xml += line('<dataroot xmlns:od="urn:schemas-microsoft-com:officedata" generated="2026-01-10T10:00:00">');
  xml += line(`<DTS_Wedstrijd><WedstrijdID>3</WedstrijdID><Start>${start(options.firstStartInMinutes)}</Start><CategorieCode>NO1</CategorieCode><Naam>Regio NoordOost 3</Naam><Plaats>Deventer</Plaats><Categorie>NO1</Categorie></DTS_Wedstrijd>`);
  xml += line(`<DTS_Wedstrijd><WedstrijdID>13</WedstrijdID><Start>${start(options.secondStartInMinutes)}</Start><CategorieCode>NO2</CategorieCode><Naam>Regio NoordOost 3</Naam><Plaats>Deventer</Plaats><Categorie>NO2</Categorie></DTS_Wedstrijd>`);
  for (const [n, name] of [['1001', 'Aardappel, Anna'], ['1002', 'Bakker, Bram'], ['1003', 'Citroen, Cas'], ['1004', 'Dijk, Dora']]) {
    xml += line(`<DTS_Licentiehouder><Wedstrijdnummer>${n}</Wedstrijdnummer><Naam>${name}</Naam><Woonplaats>Town</Woonplaats><CategorieCode>M</CategorieCode><ValidTo>2030-12-31</ValidTo></DTS_Licentiehouder>`);
  }
  const entry = (lic: string, race: string, nr: string, t1: string, signed: number) =>
    line(`<DTS_Deelname><Wedstrijdnummer>${lic}</Wedstrijdnummer><WedstrijdID>${race}</WedstrijdID><ShowNr>${nr}</ShowNr>${t1 ? `<Transponder1>${t1}</Transponder1>` : ''}<Getekend>${signed}</Getekend></DTS_Deelname>`);
  xml += entry('1001', '3', '11', 'AA-11111', 0);
  xml += entry('1002', '3', '12', 'AA-22222', 0);
  xml += entry('1003', '13', '21', 'CC-33333', 0);
  xml += entry('1004', '13', '22', '', 0);
  xml += line('</dataroot>');
  return xml;
}
