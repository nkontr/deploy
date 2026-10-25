using System.Text.Json.Serialization;

namespace ExportService.Models
{
    public class CompanyDto
    {
        [JsonPropertyName("inn")]
        public string? Inn { get; set; }

        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("industryName")]
        public string? IndustryName { get; set; }

        [JsonPropertyName("okvedCode")]
        public string? OkvedCode { get; set; }

        [JsonPropertyName("okvedName")]
        public string? OkvedName { get; set; }

        [JsonPropertyName("municipalityName")]
        public string? MunicipalityName { get; set; }

        [JsonPropertyName("settlement")]
        public string? Settlement { get; set; }

        /// <summary>Юридический адрес из ЕГРЮЛ (у юрлиц, если найден), иначе null.</summary>
        [JsonPropertyName("address")]
        public string? Address { get; set; }

        [JsonPropertyName("sizeCategory")]
        public string? SizeCategory { get; set; }

        [JsonPropertyName("employees")]
        public int? Employees { get; set; }

        [JsonPropertyName("revenueEst")]
        public decimal? RevenueEst { get; set; }

        [JsonPropertyName("revenueGrowthEst")]
        public decimal? RevenueGrowthEst { get; set; }

        [JsonPropertyName("kind")]
        public string? Kind { get; set; }

        [JsonPropertyName("excludedAt")]
        public DateOnly? ExcludedAt { get; set; }

        [JsonPropertyName("revenueSource")]
        public string? RevenueSource { get; set; }

        [JsonPropertyName("isNew")]
        public bool IsNew { get; set; }

        [JsonPropertyName("registeredAt")]
        public DateOnly? RegisteredAt { get; set; }

        [JsonPropertyName("phone")]
        public string? Phone { get; set; }

        [JsonPropertyName("email")]
        public string? Email { get; set; }
    }
}