package ru.rt.radar.radar.company;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * Полная карточка компании (GET /api/companies/{id}, /internal/companies) = CompanyShort + контакты и признаки.
 * address — юридический адрес из ЕГРЮЛ (у юрлиц, если найден), иначе null.
 * Порядок полей = порядок в JSON (contracts/examples/company.json). Неизвестное — null, поле не пропускается.
 */
public record Company(
        int id,
        String inn,
        String name,
        String industry,
        String industryName,
        String okvedCode,
        String okvedName,
        int municipalityId,
        String municipalityName,
        String settlement,
        double lat,
        double lon,
        String geoPrecision,
        String address,
        String sizeCategory,
        Integer employees,
        Long revenueEst,
        BigDecimal revenueGrowthEst,
        String revenueSource,
        boolean isEstimated,
        boolean isClient,
        String status,
        String kind,
        LocalDate excludedAt,
        boolean isNew,
        LocalDate registeredAt,
        boolean relocated,
        String ogrn,
        String subjectType,
        String phone,
        String email,
        String website,
        boolean hasLicenses,
        boolean isInnovative,
        boolean isSocial
) {

    public CompanyShort toShort() {
        return new CompanyShort(id, inn, name, industry, industryName, okvedCode, okvedName, municipalityId,
                municipalityName, settlement, lat, lon, geoPrecision, sizeCategory, employees, revenueEst, revenueGrowthEst,
                revenueSource, isEstimated, isClient, status, kind, excludedAt, isNew, registeredAt, relocated);
    }
}
