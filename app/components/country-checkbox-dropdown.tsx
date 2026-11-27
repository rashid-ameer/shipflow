import { useState } from "react";
import { regionCountries, regionProvinces } from "../models/calculated-rates";

type CountryCheckboxDropdownProps = {
  id: string;
  label?: string;
  selected: string[];
  provinces?: Record<string, string[]>;
  disabled?: boolean;
  onChange: (codes: string[]) => void;
  onProvincesChange: (provinces: Record<string, string[]>) => void;
};

export function CountryCheckboxDropdown({
  id,
  label = "Countries",
  selected,
  provinces = {},
  disabled = false,
  onChange,
  onProvincesChange,
}: CountryCheckboxDropdownProps) {
  const popoverId = `${id}-popover`;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const provinceCodes = (country: string) =>
    (regionProvinces[country] ?? []).map(({ code }) => code);

  const isWholeCountry = (country: string) =>
    selected.includes(country) && !(provinces[country]?.length);

  const summary =
    selected.length === 0
      ? "Select countries"
      : selected.length === 1
        ? (() => {
            const match = regionCountries.find(
              ({ code }) => code === selected[0],
            );
            const selectedProvinces = provinces[selected[0]] ?? [];
            const base = match
              ? `${match.label} (${match.code})`
              : selected[0];
            return selectedProvinces.length > 0
              ? `${base} · ${selectedProvinces.length} areas`
              : base;
          })()
        : `${selected.length} countries selected`;

  function setCountry(code: string, checked: boolean) {
    const nestedCodes = provinceCodes(code);

    if (checked) {
      onChange(selected.includes(code) ? selected : [...selected, code]);
      if (nestedCodes.length > 0) {
        onProvincesChange({ ...provinces, [code]: nestedCodes });
        setExpanded((current) => ({ ...current, [code]: true }));
      } else if (provinces[code]) {
        const next = { ...provinces };
        delete next[code];
        onProvincesChange(next);
      }
      return;
    }

    onChange(selected.filter((country) => country !== code));
    if (provinces[code] || nestedCodes.length > 0) {
      const next = { ...provinces };
      delete next[code];
      onProvincesChange(next);
    }
  }

  function setProvince(country: string, code: string, checked: boolean) {
    const nestedCodes = provinceCodes(country);
    const current = isWholeCountry(country)
      ? nestedCodes
      : (provinces[country] ?? []);
    const nextList = checked
      ? current.includes(code)
        ? current
        : [...current, code]
      : current.filter((province) => province !== code);

    if (checked) {
      if (!selected.includes(country)) {
        onChange([...selected, country]);
      }
      onProvincesChange({ ...provinces, [country]: nextList });
      return;
    }

    if (nextList.length === 0) {
      onChange(selected.filter((item) => item !== country));
      const next = { ...provinces };
      delete next[country];
      onProvincesChange(next);
      return;
    }

    onProvincesChange({ ...provinces, [country]: nextList });
  }

  return (
    <s-stack direction="block" gap="small-100">
      <s-text type="strong">{label}</s-text>
      <s-button
        variant="secondary"
        icon="caret-down"
        accessibilityLabel={label}
        commandFor={popoverId}
        disabled={disabled}
      >
        {summary}
      </s-button>
      {selected.length > 0 ? (
        <s-stack direction="inline" gap="small-100">
          {selected.map((code) => {
            const country = regionCountries.find(({ code: item }) => item === code);
            const selectedProvinces = provinces[code] ?? [];
            const chipLabel = `${country?.label ?? code} (${code})${
              selectedProvinces.length > 0
                ? ` · ${selectedProvinces.length} areas`
                : ""
            }`;
            return (
              <s-clickable-chip
                key={code}
                removable
                disabled={disabled}
                accessibilityLabel={`Remove ${chipLabel}`}
                onRemove={() => setCountry(code, false)}
              >
                {chipLabel}
              </s-clickable-chip>
            );
          })}
        </s-stack>
      ) : null}
      <s-popover id={popoverId} inlineSize="360px">
        <s-box padding="base">
          <s-stack direction="block" gap="small-100">
            {regionCountries.map((country) => {
              const nested = regionProvinces[country.code] ?? [];
              const hasNested = nested.length > 0;
              const selectedProvinces = provinces[country.code] ?? [];
              const whole = isWholeCountry(country.code);
              const allNestedOn =
                hasNested &&
                (whole ||
                  nested.every(({ code }) => selectedProvinces.includes(code)));
              const countryOn = hasNested
                ? allNestedOn
                : selected.includes(country.code);
              const isOpen = Boolean(expanded[country.code]);

              return (
                <s-stack
                  key={country.code}
                  direction="block"
                  gap="small-100"
                >
                  <s-stack
                    direction="inline"
                    gap="small-100"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-checkbox
                      label={`${country.label} (${country.code})`}
                      checked={countryOn}
                      disabled={disabled}
                      onChange={(event) =>
                        setCountry(country.code, event.currentTarget.checked)
                      }
                    />
                    {hasNested ? (
                      <s-button
                        variant="tertiary"
                        icon={isOpen ? "caret-down" : "caret-right"}
                        accessibilityLabel={
                          isOpen
                            ? `Collapse ${country.label} states`
                            : `Expand ${country.label} states`
                        }
                        disabled={disabled}
                        onClick={() =>
                          setExpanded((current) => ({
                            ...current,
                            [country.code]: !current[country.code],
                          }))
                        }
                      />
                    ) : null}
                  </s-stack>
                  {hasNested && isOpen ? (
                    <s-box paddingInlineStart="large">
                      <s-stack direction="block" gap="small-100">
                        {nested.map((province) => (
                          <s-checkbox
                            key={province.code}
                            label={`${province.label} (${province.code})`}
                            checked={
                              whole || selectedProvinces.includes(province.code)
                            }
                            disabled={disabled}
                            onChange={(event) =>
                              setProvince(
                                country.code,
                                province.code,
                                event.currentTarget.checked,
                              )
                            }
                          />
                        ))}
                      </s-stack>
                    </s-box>
                  ) : null}
                </s-stack>
              );
            })}
          </s-stack>
        </s-box>
      </s-popover>
    </s-stack>
  );
}
