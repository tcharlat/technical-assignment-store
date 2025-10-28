import { JSONArray, JSONObject, JSONPrimitive } from "./json-types";

export type Permission = "r" | "w" | "rw" | "none";

export type StoreResult = Store | JSONPrimitive | undefined;

export type StoreValue =
  | JSONObject
  | JSONArray
  | StoreResult
  | (() => StoreResult);

export interface IStore {
  defaultPolicy: Permission;
  allowedToRead(key: string): boolean;
  allowedToWrite(key: string): boolean;
  read(path: string): StoreResult;
  write(path: string, value: StoreValue): StoreValue;
  writeEntries(entries: JSONObject): void;
  entries(): JSONObject;
}


export const Restrict =
  (permission?: Permission) =>
    (target: Object, property: string) =>
      setPermission(target, property, permission);

export class Store implements IStore {
  defaultPolicy: Permission = "rw";

  allowedToRead(key: string): boolean {
    return ["r", "rw"].includes(getPermission(this)?.[key] ?? this.defaultPolicy);
  }

  allowedToWrite(key: string): boolean {
    return ["w", "rw"].includes(getPermission(this)?.[key] ?? this.defaultPolicy);
  }

  read(path: string): StoreResult {
    return path.split(":").reduce((obj: StoreResult, key: string) => {
      if (obj instanceof Store && !obj.allowedToRead(key))
        throw new Error("Can't read property.")
      const res = (obj as unknown as Record<string, StoreResult>)[key];
      return isFunctionStoreResult(res) ? res() : res
    }, this);
  }

  write(path: string, value: StoreValue): StoreValue {
    return path.split(":").reduce(
      (obj, key, index, paths) => {

        const CurrentClass = obj.constructor as { new(...args: any[]): Store };
        /**
         * nested write termination at the end of the path
         */
        if (index === paths.length - 1) {
          if (!obj.allowedToWrite(key))
            throw new Error("Can't write property.")
          /**
           * if the insertion is an object,
           * instantiate a store and populate it recursively
           * with the object data
           */
          if (isJSONObject(value)) {
            const nestedStore = new CurrentClass();
            nestedStore.writeEntries(value);
            obj[key] = nestedStore;
          } else {
            obj[key] = value;
          }
        }
        /**
         * when a node in the nested path is missing,
         * instantiate it as a store if the property is writable
         */
        else if (obj[key] === undefined) {
          if (!obj.allowedToWrite(key)) {
            throw new Error("Can't write property.")
          }
          obj[key] = new CurrentClass();
        }
        /**
         * always return a pointer for the next loop on the path
         */
        return obj[key] as Store & Record<string, StoreValue>;
      }, this as unknown as Store & Record<string, StoreValue>);

  }

  writeEntries(entries: JSONObject): void {
    Object.entries(entries).forEach(([path, value]) => this.write(path, value))
  }

  entries(): JSONObject {
    return Object.fromEntries(Object.entries(this).filter(([key]) => this.allowedToRead(key)))
  }
}

function isJSONObject(value: StoreValue): value is JSONObject {
  return Object.prototype.toString.call(value).slice(8, -1) === "Object";
}

function isFunctionStoreResult(value: StoreValue): value is (() => StoreResult) {
  return Object.prototype.toString.call(value).slice(8, -1) === "Function";
}

type Authorizations = Record<string, Permission | undefined>;

/**
 * Store property decoration for each class implementing the decorator
 */
const AuthorizationStore = new WeakMap<Function, Authorizations>()

/**
 * Mutate authorization singleton
 */
function setPermission(obj: Object, property: string, permission?: Permission) {
  const constructor = obj.constructor;
  const Authorizations = AuthorizationStore.get(constructor) ?? {};
  Authorizations[property] = permission
  if (!AuthorizationStore.has(constructor))
    AuthorizationStore.set(constructor, Authorizations);
}

/**
 * lookup all constructor in the prototype chain
 * and merge the permissions found in the authorization singleton
 */
function getPermission(obj: Object): Authorizations {
  const constructors: Function[] = [];
  let constructor = obj.constructor;
  while (constructor) {
    constructors.push(constructor);
    constructor = Object.getPrototypeOf(constructor.prototype)?.constructor
  }
  return constructors
    .map(ctor => AuthorizationStore.get(ctor) ?? {})
    .reduceRight(
      (permissions, ctorPermission) => ({ ...permissions, ...ctorPermission }),
      {},
    )
}