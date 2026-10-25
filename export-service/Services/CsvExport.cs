using System.Globalization;
using System.Text;
using System.Text.Json;
using CsvHelper;
using CsvHelper.Configuration;
using ExportService.Models;

namespace ExportService.Services
{
    /// <summary>
    /// Запись выгрузки потоком: компании из ответа core-api читаются по одной и сразу уходят клиенту — весь список
    /// в памяти не собирается. Форматы и колонки — docs/tz/06-csharp-export.md: UTF-8 с BOM (иначе русский Excel
    /// покажет кракозябры), разделитель «;», \r\n, числа ru-RU без разделителя тысяч, даты dd.MM.yyyy.
    /// </summary>
    public static class CsvExport
    {
        private static readonly CultureInfo Ru = CultureInfo.GetCultureInfo("ru-RU");
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
        /// <summary>Kestrel запрещает синхронную запись в ответ: буфер с запасом и асинхронный сброс каждые N строк.</summary>
        private const int FlushEvery = 50;
        private const int BufferChars = 1 << 16;

        public static async Task<int> WriteAsync(Stream companiesJson, Stream output, string format, CancellationToken ct)
        {
            await using var writer = new StreamWriter(output, new UTF8Encoding(true), BufferChars, leaveOpen: true);
            await using var csv = new CsvWriter(writer, new CsvConfiguration(Ru) { Delimiter = ";", NewLine = "\r\n" });
            var bitrix = format == "bitrix";
            WriteHeader(csv, bitrix);
            await csv.NextRecordAsync();

            int rows = 0;
            await foreach (var c in JsonSerializer.DeserializeAsyncEnumerable<CompanyDto>(companiesJson, Json, ct))
            {
                if (c == null)
                {
                    continue;
                }
                if (bitrix) WriteBitrixRow(csv, c); else WriteCsvRow(csv, c);
                await csv.NextRecordAsync();
                if (++rows % FlushEvery == 0)
                {
                    await csv.FlushAsync();
                    await writer.FlushAsync();
                }
            }
            await csv.FlushAsync();
            await writer.FlushAsync();
            return rows;
        }

        private static void WriteHeader(CsvWriter csv, bool bitrix)
        {
            var columns = bitrix
                ? new[] { "Название лида", "Название компании", "Рабочий телефон", "Рабочий e-mail", "Адрес", "Источник", "Комментарий" }
                : new[] { "ИНН", "Наименование", "Отрасль", "ОКВЭД", "Муниципалитет", "Населённый пункт", "Юридический адрес (ЕГРЮЛ)", "Категория", "Численность",
                          "Выручка, руб. (оценка)", "Рост выручки, % (оценка)", "Клиент РТ", "Дата исключения из реестра",
                          "Источник выручки", "Новая компания", "Дата регистрации", "Телефон", "E-mail" };
            foreach (var column in columns)
            {
                csv.WriteField(column);
            }
        }

        private static void WriteCsvRow(CsvWriter csv, CompanyDto c)
        {
            csv.WriteField(c.Inn ?? "");
            csv.WriteField(c.Name ?? "");
            csv.WriteField(c.IndustryName ?? "");
            csv.WriteField($"{c.OkvedCode} {c.OkvedName}".Trim());
            csv.WriteField(c.MunicipalityName ?? "");
            csv.WriteField(c.Settlement ?? "");
            csv.WriteField(c.Address ?? "");
            csv.WriteField(Size(c.SizeCategory));
            csv.WriteField(c.Employees?.ToString(Ru) ?? "");
            csv.WriteField(c.RevenueEst?.ToString("0", Ru) ?? "");              // рубли, целое: 18500000
            csv.WriteField(c.RevenueGrowthEst?.ToString("0.#", Ru) ?? "");      // %, один знак: 12,5
            csv.WriteField(c.Kind switch
            {
                "ours" => "Да",
                "others" => "Нет",
                "excluded" => "Был клиентом, исключён из реестра",
                _ => ""
            });
            csv.WriteField(c.ExcludedAt?.ToString("dd.MM.yyyy", Ru) ?? "");
            csv.WriteField(Source(c.RevenueSource));
            csv.WriteField(c.IsNew ? "Да" : "Нет");
            csv.WriteField(c.RegisteredAt?.ToString("dd.MM.yyyy", Ru) ?? "");
            csv.WriteField(c.Phone ?? "");
            csv.WriteField(c.Email ?? "");
        }

        private static void WriteBitrixRow(CsvWriter csv, CompanyDto c)
        {
            csv.WriteField($"Радар: {c.Name}");
            csv.WriteField(c.Name ?? "");
            csv.WriteField(c.Phone ?? "");
            csv.WriteField(c.Email ?? "");
            // Адрес лида: юридический из ЕГРЮЛ, если найден, иначе район и населённый пункт
            csv.WriteField(!string.IsNullOrEmpty(c.Address) ? c.Address
                : string.IsNullOrEmpty(c.Settlement) ? c.MunicipalityName ?? "" : $"{c.MunicipalityName}, {c.Settlement}");
            csv.WriteField("Радар присутствия");
            var status = c.Kind switch
            {
                "ours" => "Действующий клиент РТ",
                "others" => "Потенциальный клиент",
                "excluded" => "Исключён из реестра МСП",
                _ => ""
            };
            var revenue = c.RevenueEst.HasValue ? $"{c.RevenueEst.Value.ToString("0", Ru)} руб. ({Source(c.RevenueSource)})" : "нет данных";
            csv.WriteField($"ИНН {c.Inn}; ОКВЭД {c.OkvedCode}; отрасль {c.IndustryName}; выручка {revenue}; {status}");
        }

        private static string Size(string? code) => code switch
        {
            "micro" => "Микро",
            "small" => "Малое",
            "medium" => "Среднее",
            _ => code ?? ""
        };

        private static string Source(string? code) => code switch
        {
            "fns" => "ФНС",
            "model" => "оценка",
            _ => code ?? ""
        };
    }
}
