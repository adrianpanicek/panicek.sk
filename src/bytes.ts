export const encode = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};
export const decode = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
