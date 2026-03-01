export const IPV4_REGEX = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
export const FQDN_REGEX = /^(?=.{1,253}$)(?:(?!-)[a-zA-Z0-9-]{1,63}(?<!-)\.)+[a-zA-Z]{2,63}$/;
export const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export const isValidIpOrFqdn = (value: string): boolean => {
    if (!value) return false;
    return IPV4_REGEX.test(value) || FQDN_REGEX.test(value);
};

export const isValidMacAddress = (value: string): boolean => {
    if (!value) return false;
    return MAC_REGEX.test(value);
};
